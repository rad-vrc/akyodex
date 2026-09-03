import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSentryTracing,
  resetSentryTracingLoaderForTests,
  scheduleSentryTracingLoad,
} from "./sentry-tracing-loader";

type TracingModule = typeof import("./sentry-tracing");

function fakeModule(options: { install?: boolean } = {}) {
  let installCalls = 0;
  const mod = {
    installBrowserTracing: () => {
      installCalls += 1;
      return options.install ?? true;
    },
  } as unknown as TracingModule;
  return { mod, installCalls: () => installCalls };
}

const noDelay = async () => {};

test("読み込みは共有 Promise に集約され、同時に呼んでも import と install は 1 回", async (t) => {
  t.after(resetSentryTracingLoaderForTests);
  const { mod, installCalls } = fakeModule();
  let imports = 0;
  const importer = async () => {
    imports += 1;
    return mod;
  };
  const results = await Promise.all([
    loadSentryTracing({ importer, delay: noDelay }),
    loadSentryTracing({ importer, delay: noDelay }),
    loadSentryTracing({ importer, delay: noDelay }),
  ]);
  assert.deepEqual(results, ["installed", "installed", "installed"]);
  assert.equal(imports, 1);
  assert.equal(installCalls(), 1);
  // 後から呼んでも同じ結果で、再 import しない
  assert.equal(await loadSentryTracing({ importer, delay: noDelay }), "installed");
  assert.equal(imports, 1);
});

test("読み込み失敗は有限回リトライし、最後は failed で確定する（エラー捕捉には影響しない）", async (t) => {
  t.after(resetSentryTracingLoaderForTests);
  let imports = 0;
  const importer = async () => {
    imports += 1;
    throw new Error("chunk load failed");
  };
  const delays: number[] = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await loadSentryTracing({
      importer,
      retryDelayMs: [10, 20],
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    assert.equal(result, "failed");
    assert.equal(imports, 3, "初回 + 2 回のリトライ");
    assert.deepEqual(delays, [10, 20]);
  } finally {
    console.warn = originalWarn;
  }
  // 失敗で確定した後は再試行しない
  assert.equal(await loadSentryTracing({ importer, delay: noDelay }), "failed");
  assert.equal(imports, 3);
});

test("一度失敗してもリトライで成功すれば install される", async (t) => {
  t.after(resetSentryTracingLoaderForTests);
  const { mod, installCalls } = fakeModule();
  let imports = 0;
  const importer = async () => {
    imports += 1;
    if (imports === 1) throw new Error("transient");
    return mod;
  };
  assert.equal(await loadSentryTracing({ importer, retryDelayMs: [1], delay: noDelay }), "installed");
  assert.equal(installCalls(), 1);
});

test("クライアント未初期化（install が false）なら no-client で確定する", async (t) => {
  t.after(resetSentryTracingLoaderForTests);
  const { mod } = fakeModule({ install: false });
  assert.equal(await loadSentryTracing({ importer: async () => mod, delay: noDelay }), "no-client");
});

interface FakeWindow {
  document: { readyState: string };
  listeners: Map<string, () => void>;
  idle: Array<{ cb: () => void; timeout?: number }>;
  timeouts: Array<{ cb: () => void; ms: number }>;
  cancelledIdle: number[];
  clearedTimeouts: number[];
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
}

function fakeWindow(options: { readyState: string; idle: boolean }): FakeWindow {
  const win: FakeWindow = {
    document: { readyState: options.readyState },
    listeners: new Map(),
    idle: [],
    timeouts: [],
    cancelledIdle: [],
    clearedTimeouts: [],
    setTimeout: (cb, ms) => {
      win.timeouts.push({ cb, ms });
      return win.timeouts.length;
    },
    clearTimeout: (id) => {
      win.clearedTimeouts.push(id);
    },
    addEventListener: (type, cb) => {
      win.listeners.set(type, cb);
    },
    removeEventListener: (type) => {
      win.listeners.delete(type);
    },
  };
  if (options.idle) {
    win.requestIdleCallback = (cb, opts) => {
      win.idle.push({ cb, timeout: opts?.timeout });
      return win.idle.length;
    };
    win.cancelIdleCallback = (id) => {
      win.cancelledIdle.push(id);
    };
  }
  return win;
}

test("scheduleSentryTracingLoad は load 後に requestIdleCallback（上限付き）で読み込み、非対応なら setTimeout", async () => {
  const win = fakeWindow({ readyState: "loading", idle: true });
  let loads = 0;
  const loader = async () => {
    loads += 1;
  };
  scheduleSentryTracingLoad(win as unknown as Window, { idleTimeoutMs: 4000, loader });
  assert.equal(win.idle.length, 0, "load 前は予約しない");
  win.listeners.get("load")?.();
  assert.equal(win.idle.length, 1);
  assert.equal(win.idle[0].timeout, 4000, "idle の上限を渡す");
  win.idle[0].cb();
  assert.equal(loads, 1);

  const win2 = fakeWindow({ readyState: "complete", idle: false });
  scheduleSentryTracingLoad(win2 as unknown as Window, { idleTimeoutMs: 4000, loader });
  assert.equal(win2.timeouts.length, 1, "readyState=complete なら即予約");
  assert.equal(win2.timeouts[0].ms, 4000, "requestIdleCallback 非対応は setTimeout");
  win2.timeouts[0].cb();
  assert.equal(loads, 2);
});

test("scheduleSentryTracingLoad のキャンセルは予約を取り消す", () => {
  const win = fakeWindow({ readyState: "complete", idle: true });
  let loads = 0;
  const cancel = scheduleSentryTracingLoad(win as unknown as Window, {
    idleTimeoutMs: 4000,
    loader: async () => {
      loads += 1;
    },
  });
  cancel();
  assert.deepEqual(win.cancelledIdle, [1]);
  win.idle[0].cb();
  assert.equal(loads, 1, "既に発火した callback は止められないが、予約自体は取り消されている");

  const win2 = fakeWindow({ readyState: "loading", idle: true });
  const cancel2 = scheduleSentryTracingLoad(win2 as unknown as Window, { idleTimeoutMs: 1, loader: async () => {} });
  cancel2();
  assert.equal(win2.listeners.has("load"), false, "load リスナーを外す");
});
