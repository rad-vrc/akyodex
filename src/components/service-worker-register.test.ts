import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";

/**
 * ServiceWorkerRegister の配線テスト（jsdom で実際にマウントする）。
 *
 * 登録ロジック自体は src/lib/service-worker-registration.test.ts で検証済み。
 * ここでは effect の cleanup と registrar の失効フラグが実際につながっていること、
 * つまり「登録待機中にアンマウント → 遅れて登録完了」で interval も listener も
 * 残らないことと、戻り値なしのときに interval を作らないことを確認する。
 * react-dom/client はモジュール初期化時に DOM の有無を判定するため、グローバルを
 * 差し替えた後に動的 import する（mini-akyo-bg.test.ts と同じ手法）。
 */

interface FakeRegistrationLike {
  scope: string;
  installing: null;
  waiting: null;
  listeners: Map<string, () => void>;
  updateCalls: number;
  update(): Promise<void>;
  addEventListener(type: string, listener: () => void): void;
}

function fakeRegistration(): FakeRegistrationLike {
  const registration: FakeRegistrationLike = {
    scope: "https://example.test/",
    installing: null,
    waiting: null,
    listeners: new Map(),
    updateCalls: 0,
    async update() {
      registration.updateCalls += 1;
    },
    addEventListener(type, listener) {
      registration.listeners.set(type, listener);
    },
  };
  return registration;
}

interface Harness {
  root: Root;
  /** register() を外から解決 / 拒否する */
  resolveRegister: (value: unknown) => void;
  registerCalls: number;
  activeIntervals: () => number;
  cleanup: () => void;
}

const G = globalThis as Record<string, unknown>;

async function createHarness(): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', {
    url: "https://example.test/zukan",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;

  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  // --- navigator.serviceWorker: register() の完了を外から制御する ---
  let resolveRegister: (value: unknown) => void = () => {};
  const pending = new Promise<unknown>((resolve) => {
    resolveRegister = resolve;
  });
  const harnessState = { registerCalls: 0 };
  const serviceWorker = {
    controller: null,
    register: () => {
      harnessState.registerCalls += 1;
      return pending;
    },
    addEventListener: () => {},
  };
  Object.defineProperty(win.navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  // load 待ちに入らず、マウント直後に register() が走るようにする
  Object.defineProperty(win.document, "readyState", { value: "complete", configurable: true });

  // --- setInterval / clearInterval の監視 ---
  const intervals = new Set<number>();
  const origSetInterval = win.setInterval.bind(win);
  const origClearInterval = win.clearInterval.bind(win);
  const trackedSetInterval = ((fn: TimerHandler, ms?: number) => {
    const id = origSetInterval(fn, ms) as unknown as number;
    intervals.add(id);
    return id;
  }) as typeof win.setInterval;
  const trackedClearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    origClearInterval(id);
  }) as typeof win.clearInterval;
  win.setInterval = trackedSetInterval;
  win.clearInterval = trackedClearInterval;

  expose("window", win);
  expose("document", win.document);
  expose("navigator", win.navigator);
  expose("HTMLElement", win.HTMLElement);
  expose("Node", win.Node);
  expose("setInterval", trackedSetInterval);
  expose("clearInterval", trackedClearInterval);
  expose("IS_REACT_ACT_ENVIRONMENT", true);

  const { createRoot } = await import("react-dom/client");
  const mount = win.document.getElementById("mount") as HTMLElement;
  const root = createRoot(mount);

  return {
    root,
    resolveRegister,
    get registerCalls() {
      return harnessState.registerCalls;
    },
    activeIntervals: () => intervals.size,
    cleanup: () => {
      for (const id of intervals) origClearInterval(id);
      for (const [key, desc] of savedDescriptors) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete G[key];
      }
      dom.window.close();
    },
  };
}

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function loadComponent() {
  const mod = await import("./service-worker-register");
  return mod.ServiceWorkerRegister;
}

/** コンポーネントの console.log を黙らせる */
function silenceConsoleLog(): () => void {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

test("登録待機中にアンマウントすると、遅れて登録が完了しても interval も updatefound listener も残らない", async (t) => {
  const restore = silenceConsoleLog();
  t.after(restore);
  const h = await createHarness();
  t.after(() => h.cleanup());
  const ServiceWorkerRegister = await loadComponent();

  await act(async () => {
    h.root.render(createElement(ServiceWorkerRegister));
  });
  await flush();
  assert.equal(h.registerCalls, 1, "マウント直後に register() が呼ばれる");
  assert.equal(h.activeIntervals(), 0, "登録完了前は interval なし");

  // 登録完了前にアンマウント
  await act(async () => {
    h.root.unmount();
  });

  // 遅れて登録が完了する
  const registration = fakeRegistration();
  await act(async () => {
    h.resolveRegister(registration);
  });
  await flush();
  await flush();

  assert.equal(h.activeIntervals(), 0, "アンマウント後の遅延完了で interval を作らない");
  assert.equal(registration.listeners.size, 0, "updatefound listener を付けない");
  assert.equal(registration.updateCalls, 0, "update() も呼ばない");
});

test("register() が undefined を返したら interval を作らない", async (t) => {
  const restore = silenceConsoleLog();
  t.after(restore);
  const h = await createHarness();
  t.after(() => h.cleanup());
  const ServiceWorkerRegister = await loadComponent();

  await act(async () => {
    h.root.render(createElement(ServiceWorkerRegister));
  });
  await flush();
  await act(async () => {
    h.resolveRegister(undefined);
  });
  await flush();
  await flush();

  assert.equal(h.activeIntervals(), 0);

  await act(async () => {
    h.root.unmount();
  });
});

test("正常登録では interval が 1 本でき、アンマウントで止まる", async (t) => {
  const restore = silenceConsoleLog();
  t.after(restore);
  const h = await createHarness();
  t.after(() => h.cleanup());
  const ServiceWorkerRegister = await loadComponent();

  await act(async () => {
    h.root.render(createElement(ServiceWorkerRegister));
  });
  await flush();
  const registration = fakeRegistration();
  await act(async () => {
    h.resolveRegister(registration);
  });
  await flush();
  await flush();

  assert.equal(h.activeIntervals(), 1, "定期更新チェックの interval");
  assert.ok(registration.listeners.has("updatefound"));
  assert.equal(registration.updateCalls, 1, "初回の update()");

  await act(async () => {
    h.root.unmount();
  });
  assert.equal(h.activeIntervals(), 0, "アンマウントで interval が止まる");
});
