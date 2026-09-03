import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
  isExpectedServiceWorkerError,
  runServiceWorkerRegistration,
  sanitizeServiceWorkerExtra,
  shouldIgnoreUpdateError,
  type ServiceWorkerLike,
  type ServiceWorkerPhase,
  type ServiceWorkerRegistrarDeps,
  type ServiceWorkerRegistrationLike,
} from "./service-worker-registration";

interface FakeRegistration extends ServiceWorkerRegistrationLike {
  listeners: Map<string, () => void>;
  updateCalls: number;
  updateResult: () => Promise<unknown>;
}

function fakeRegistration(options: { installing?: ServiceWorkerLike | null } = {}): FakeRegistration {
  const registration: FakeRegistration = {
    scope: "https://example.test/",
    installing: options.installing ?? null,
    listeners: new Map(),
    updateCalls: 0,
    updateResult: async () => undefined,
    async update() {
      registration.updateCalls += 1;
      return registration.updateResult();
    },
    addEventListener(type, listener) {
      registration.listeners.set(type, listener);
    },
  };
  return registration;
}

interface Recorder {
  registered: FakeRegistration[];
  updateAvailable: number;
  intervals: Array<{ id: number; callback: () => void; ms: number }>;
  reports: Array<{ phase: ServiceWorkerPhase; error: unknown; additional?: Record<string, unknown> }>;
  logs: unknown[][];
}

function createDeps(
  register: () => Promise<FakeRegistration | null | undefined>,
  overrides: Partial<ServiceWorkerRegistrarDeps<FakeRegistration>> = {},
): { deps: ServiceWorkerRegistrarDeps<FakeRegistration>; recorder: Recorder } {
  const recorder: Recorder = { registered: [], updateAvailable: 0, intervals: [], reports: [], logs: [] };
  let nextIntervalId = 1;
  const deps: ServiceWorkerRegistrarDeps<FakeRegistration> = {
    register,
    hasController: () => true,
    isDisposed: () => false,
    isOnline: () => true,
    readyState: () => "complete",
    onRegistered: (registration) => {
      recorder.registered.push(registration);
    },
    onUpdateAvailable: () => {
      recorder.updateAvailable += 1;
    },
    onIntervalCreated: () => {},
    reportError: (phase, error, additional) => {
      recorder.reports.push({ phase, error, additional });
    },
    setInterval: (callback, ms) => {
      const id = nextIntervalId++;
      recorder.intervals.push({ id, callback, ms });
      return id;
    },
    log: (...args) => {
      recorder.logs.push(args);
    },
    logError: (...args) => {
      recorder.logs.push(args);
    },
    ...overrides,
  };
  return { deps, recorder };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

test("register() が undefined / null を返したら、state・listener・interval を作らず、報告もしない", async () => {
  for (const value of [undefined, null]) {
    const { deps, recorder } = createDeps(async () => value);
    const outcome = await runServiceWorkerRegistration(deps);
    assert.equal(outcome, "no-registration");
    assert.equal(recorder.registered.length, 0, "state を作らない");
    assert.equal(recorder.intervals.length, 0, "interval を作らない");
    assert.equal(recorder.reports.length, 0, "Sentry へ報告しない");
  }
});

test("正常登録では初回 update・updatefound listener・1 時間ごとの interval を作り、新版検知で通知する", async () => {
  const installing: ServiceWorkerLike & { fire: () => void } = {
    state: "installing",
    fire: () => {},
    addEventListener(_type, listener) {
      installing.fire = listener;
    },
  };
  const registration = fakeRegistration({ installing });
  const createdIds: number[] = [];
  const { deps, recorder } = createDeps(async () => registration, {
    onIntervalCreated: (id) => {
      createdIds.push(id);
    },
  });

  const outcome = await runServiceWorkerRegistration(deps);
  assert.equal(outcome, "registered");
  assert.deepEqual(recorder.registered, [registration]);
  assert.equal(registration.updateCalls, 1, "初回の update() を呼ぶ");
  assert.ok(registration.listeners.has("updatefound"));
  assert.equal(recorder.intervals.length, 1);
  assert.equal(recorder.intervals[0].ms, SERVICE_WORKER_UPDATE_INTERVAL_MS);
  assert.deepEqual(createdIds, [recorder.intervals[0].id], "interval の id を同期で通知する");

  // 定期チェックは update() を呼ぶ
  recorder.intervals[0].callback();
  assert.equal(registration.updateCalls, 2);

  // 新しい worker が installed になり controller があれば通知
  registration.listeners.get("updatefound")?.();
  installing.state = "installed";
  installing.fire();
  assert.equal(recorder.updateAvailable, 1);
  assert.equal(recorder.reports.length, 0);
});

test("登録待機中に dispose されたら、遅れて登録が完了しても state・listener・interval を作らない", async () => {
  const registration = fakeRegistration();
  let resolveRegister: (value: FakeRegistration) => void = () => {};
  const pending = new Promise<FakeRegistration>((resolve) => {
    resolveRegister = resolve;
  });
  let disposed = false;
  const { deps, recorder } = createDeps(() => pending, { isDisposed: () => disposed });

  const run = runServiceWorkerRegistration(deps);
  disposed = true; // アンマウント（effect cleanup）
  resolveRegister(registration);
  const outcome = await run;

  assert.equal(outcome, "disposed");
  assert.equal(recorder.registered.length, 0);
  assert.equal(registration.updateCalls, 0, "update() も呼ばない");
  assert.equal(registration.listeners.size, 0, "listener を付けない");
  assert.equal(recorder.intervals.length, 0, "interval を作らない");
  assert.equal(recorder.reports.length, 0);
});

test("想定外の登録失敗は phase=register で報告し、readyState を添える", async () => {
  const failure = new Error("boom");
  const { deps, recorder } = createDeps(async () => {
    throw failure;
  });
  const outcome = await runServiceWorkerRegistration(deps);
  assert.equal(outcome, "failed");
  assert.equal(recorder.reports.length, 1);
  assert.equal(recorder.reports[0].phase, "register");
  assert.equal(recorder.reports[0].error, failure);
  assert.deepEqual(recorder.reports[0].additional, { readyState: "complete" });
  assert.equal(recorder.intervals.length, 0);
});

test("初回 update の失敗は無視条件に当たらなければ phase=update, stage=initial-check で報告する", async () => {
  const registration = fakeRegistration();
  registration.updateResult = async () => {
    throw new Error("unexpected update failure");
  };
  const { deps, recorder } = createDeps(async () => registration);
  await runServiceWorkerRegistration(deps);
  await flushMicrotasks();
  assert.equal(recorder.reports.length, 1);
  assert.equal(recorder.reports[0].phase, "update");
  assert.deepEqual(recorder.reports[0].additional, {
    scope: "https://example.test/",
    stage: "initial-check",
  });
});

test("初回 update の失敗でも、無視条件（オフライン中の fetch 失敗など）なら報告しない", async () => {
  const registration = fakeRegistration();
  registration.updateResult = async () => {
    throw new Error("Failed to fetch");
  };
  const { deps, recorder } = createDeps(async () => registration, { isOnline: () => false });
  await runServiceWorkerRegistration(deps);
  await flushMicrotasks();
  assert.equal(recorder.reports.length, 0);
});

test("isExpectedServiceWorkerError は未対応・セキュリティ・WRS の既知挙動だけを除外する", () => {
  const securityError = new Error("denied");
  securityError.name = "SecurityError";
  assert.equal(isExpectedServiceWorkerError("register", securityError), true);
  assert.equal(
    isExpectedServiceWorkerError("register", new Error("Failed to register a ServiceWorker: x")),
    true,
  );
  assert.equal(isExpectedServiceWorkerError("register", new Error("The operation is insecure")), true);
  const wrsError = new Error("Rejected");
  wrsError.stack = "Error: Rejected\n    at wrsParams.serviceWorkers.navigator.serviceWorker.register (<anonymous>:12:648)";
  assert.equal(isExpectedServiceWorkerError("register", wrsError), true);
  assert.equal(isExpectedServiceWorkerError("update", wrsError), false, "WRS 判定は register 段だけ");
  assert.equal(isExpectedServiceWorkerError("register", new Error("boom")), false);
  assert.equal(
    isExpectedServiceWorkerError("register", new TypeError("Cannot read properties of undefined (reading 'scope')")),
    false,
    "戻り値なしは例外ではなく分岐で扱うので、ここでは除外しない",
  );
});

test("shouldIgnoreUpdateError は更新失敗・リダイレクト・オフライン中のネットワーク失敗を無視する", () => {
  assert.equal(shouldIgnoreUpdateError(new Error("Failed to update a ServiceWorker for scope"), true), true);
  assert.equal(shouldIgnoreUpdateError(new Error("The script resource is behind a redirect"), true), true);
  assert.equal(shouldIgnoreUpdateError(new Error("Failed to fetch"), false), true);
  assert.equal(shouldIgnoreUpdateError(new Error("Failed to fetch"), true), false, "オンラインなら報告する");
  assert.equal(shouldIgnoreUpdateError(new Error("something else"), false), false);
});

test("sanitizeServiceWorkerExtra は scope を pathname にし、URL・クエリ・資格情報らしき項目を落とす", () => {
  const sanitized = sanitizeServiceWorkerExtra(
    {
      scope: "https://example.test/app/",
      stage: "initial-check",
      token: "secret",
      callback_url: "https://evil.example/",
      note: "see https://example.test/x",
      query: "a=1&b=2",
      readyState: "complete",
    },
    "https://example.test",
  );
  assert.deepEqual(sanitized, { scope: "/app/", stage: "initial-check", readyState: "complete" });
  assert.deepEqual(sanitizeServiceWorkerExtra({ scope: "not a url" }, "https://example.test"), { scope: "/not%20a%20url" });
});
