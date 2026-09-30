import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { createCatalogPayload } from "@/lib/catalog-payload";
import type { CatalogRequestTiming } from "@/lib/catalog-diagnostics";
import type { AkyoData } from "@/types/akyo";
import { loadCompleteCatalogData } from "./catalog-data-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const payload = (id: string) => ({ data: [{ id, avatarName: id, nickname: id, category: "Test" }] });

// Control only this module's timers, without freezing node:test's own deadline.
function harness(t: TestContext) {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = new Map<ReturnType<typeof setTimeout>, { delay: number; run: () => void }>();
  const scheduled: number[] = [];
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) => {
    const handle = realSetTimeout(() => {}, 60_000);
    handle.unref();
    timers.set(handle, { delay, run: callback });
    scheduled.push(delay);
    return handle;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", (handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle);
    realClearTimeout(handle);
  });
  const calls: { url: string; signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }[] = [];
  const requests: CatalogRequestTiming[] = [];
  const phases: string[] = [];
  const controller = new AbortController();
  let time = 0;
  const options = {
    lang: "ja" as const, catalogUrl: "/api/catalog/ja", r2BaseUrl: "https://images.example.com",
    signal: controller.signal, now: () => time,
    fetchImpl: (async (url, init) => {
      assert.deepEqual(Object.keys(init ?? {}), ["signal"]);
      const response = deferred<Response>();
      calls.push({ url: String(url), signal: init!.signal!, response });
      // Intentionally ignore abort: late responses must not delay or overwrite the winner.
      return response.promise;
    }) as typeof fetch,
    phaseRecorder: {
      startPhase: (phase: string) => phases.push(`start:${phase}`),
      endPhase: (phase: string) => phases.push(`end:${phase}`),
      recordRequest: (timing: CatalogRequestTiming) => requests.push(timing),
    },
  };
  t.after(() => {
    controller.abort();
    for (const handle of timers.keys()) realClearTimeout(handle);
  });
  return {
    calls, requests, phases, options, controller, timers, scheduled,
    time: (value: number) => { time = value; },
    fire(delay: number) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `missing ${delay}ms timer`);
      timers.delete(entry[0]);
      realClearTimeout(entry[0]);
      entry[1].run();
    },
  };
}

test("fast API keeps the preload conditions and clears the unused hedge timer", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  h.calls[0].response.resolve(Response.json(payload("api")));
  assert.equal((await loading).source, "api");
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.scheduled.sort((a, b) => a - b), [2000, 15000]);
  assert.equal(h.timers.size, 0);
});

test("the hedge delay is configurable without resetting the overall deadline", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData({ ...h.options, hedgeDelayMs: 75 });
  h.time(75);
  h.fire(75);
  h.calls[1].response.resolve(Response.json(payload("r2")));
  assert.equal((await loading).source, "r2");
  assert.deepEqual(h.scheduled, [15000, 75]);
});

for (const stalledAt of ["headers", "body"] as const) {
  test(`R2 completes while API ${stalledAt} remain stalled; late data cannot replace it`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const body = deferred<unknown>();
    const loading = loadCompleteCatalogData(h.options);
    void loading.catch(() => {}); // Keep failure-path cleanup observable without an unhandled rejection.
    if (stalledAt === "body") {
      const response = Response.json({});
      response.json = () => body.promise;
      h.calls[0].response.resolve(response);
      await setImmediate();
    }
    h.time(2000);
    h.fire(2000);
    assert.equal(h.calls.length, 2);
    assert.match(h.calls[1].url, /akyo-data-ja.json$/);
    h.time(2500);
    h.calls[1].response.resolve(Response.json(payload("r2")));
    const result = await loading;
    assert.equal(result.source, "r2");
    assert.equal(result.items[0].id, "r2");
    assert.equal(h.calls[0].signal.aborted, true);
    assert.equal(h.timers.size, 0);
    const apiTiming = h.requests.find((request) => request.source === "api")!;
    assert.equal(apiTiming.outcome, "aborted");
    assert.equal(apiTiming.abortReason, "superseded");
    assert.equal(apiTiming.status, stalledAt === "body" ? 200 : null);
    const r2Timing = h.requests.find((request) => request.source === "r2")!;
    assert.equal(r2Timing.trigger, "delayed-hedge");
    assert.equal(r2Timing.startOffsetMs, 2000);
    const recorded = JSON.stringify(h.requests);
    h.time(11718);
    if (stalledAt === "body") body.resolve(payload("late-api"));
    else h.calls[0].response.resolve(Response.json(payload("late-api")));
    await setImmediate();
    assert.equal(result.items[0].id, "r2");
    assert.equal(JSON.stringify(h.requests), recorded, "late work must not mutate recorded diagnostics");
    assert.deepEqual(h.phases, ["start:normalize", "end:normalize"]);
  });
}

test("API can still win after the hedge starts, even if the losing request never settles", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  h.fire(2000);
  h.calls[0].response.resolve(Response.json(payload("api")));
  assert.equal((await loading).source, "api");
  assert.equal(h.calls[1].signal.aborted, true);
  h.calls[1].response.reject(new Error("late network failure"));
  await setImmediate();
  assert.equal(h.requests.length, 2);
});

for (const failure of ["http", "network", "invalid"] as const) {
  test(`early API ${failure} failure starts R2 immediately and only once`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const loading = loadCompleteCatalogData(h.options);
    if (failure === "network") h.calls[0].response.reject(new Error("offline"));
    else h.calls[0].response.resolve(Response.json(failure === "invalid" ? { data: [] } : {}, { status: failure === "http" ? 503 : 200 }));
    await setImmediate();
    assert.equal(h.calls.length, 2, "must not wait for the hedge timer");
    assert.ok(![...h.timers.values()].some((timer) => timer.delay === 2000));
    h.calls[1].response.resolve(Response.json(payload("r2")));
    assert.equal((await loading).source, "r2");
    assert.equal(h.requests.find((request) => request.source === "r2")?.trigger, "fallback");
  });
}

test("an invalid R2 response cannot win or start snapshot while API is pending", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  void loading.catch(() => {});
  h.fire(2000);
  const wrongLanguage = await createCatalogPayload("en", payload("bad").data as AkyoData[]);
  h.calls[1].response.resolve(Response.json(wrongLanguage));
  await setImmediate();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].signal.aborted, false);
  h.calls[0].response.resolve(Response.json(payload("api")));
  assert.equal((await loading).source, "api");
});

test("snapshot starts only after both live attempts fail, in either completion order", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  h.fire(2000);
  h.calls[1].response.resolve(Response.json({}, { status: 503 }));
  await setImmediate();
  assert.equal(h.calls.length, 2);
  h.calls[0].response.reject(new Error("offline"));
  await setImmediate();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].url, "/catalog/catalog-v1-ja.json");
  h.calls[2].response.resolve(Response.json(payload("snapshot")));
  assert.equal((await loading).source, "snapshot");
  assert.equal(h.timers.size, 0);
});

test("hedge racing an API rejection still starts only one R2 request", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  h.calls[0].response.reject(new Error("offline"));
  h.fire(2000);
  await setImmediate();
  assert.equal(h.calls.length, 2);
  h.calls[1].response.resolve(Response.json(payload("r2")));
  await loading;
});

test("all failures preserve the aggregate cause and clear timers", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  const rejected = assert.rejects(loading, (error: Error) => {
    assert.match(error.message, /All complete catalog sources failed/);
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors.length, 3);
    return true;
  });
  for (let index = 0; index < 3; index++) {
    h.calls[index].response.resolve(Response.json({}, { status: 503 }));
    await setImmediate();
  }
  await rejected;
  assert.equal(h.timers.size, 0);
});

for (const afterHedge of [false, true]) {
  test(`caller abort ${afterHedge ? "after" : "before"} hedge stops all work without fallback`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const loading = loadCompleteCatalogData(h.options);
    const rejected = assert.rejects(loading, { name: "AbortError" });
    if (afterHedge) h.fire(2000);
    h.controller.abort();
    await rejected;
    assert.equal(h.calls.length, afterHedge ? 2 : 1);
    assert.ok(h.calls.every((call) => call.signal.aborted));
    assert.ok(h.requests.every((request) => request.abortReason === "caller"));
    assert.equal(h.timers.size, 0);
  });
}

test("one deadline covers both headers and body, and a new attempt can succeed after timeout", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = deferred<unknown>();
  const response = Response.json({});
  response.json = () => body.promise;
  const loading = loadCompleteCatalogData(h.options);
  const rejected = assert.rejects(loading, { name: "CatalogDeadlineError" });
  h.calls[0].response.resolve(response);
  await setImmediate();
  h.time(2000);
  h.fire(2000);
  h.time(15000);
  h.fire(15000);
  await rejected;
  assert.equal(h.calls.length, 2, "no snapshot after the shared deadline");
  assert.ok(h.calls.every((call) => call.signal.aborted));
  assert.ok(h.requests.every((request) => request.outcome === "timeout" && request.abortReason === "deadline"));
  assert.equal(h.requests.find((request) => request.source === "api")?.status, 200);
  assert.equal(h.timers.size, 0);
  const retry = loadCompleteCatalogData(h.options);
  h.calls[2].response.resolve(Response.json(payload("retry")));
  assert.equal((await retry).items[0].id, "retry");
});

test("a response after the budget expires cannot win before the delayed timer callback", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  const rejected = assert.rejects(loading, { name: "CatalogDeadlineError" });
  h.time(15001);
  h.calls[0].response.resolve(Response.json(payload("late")));
  await rejected;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].signal.aborted, true, "an unread body must still be cancelled after diagnostics are recorded");
});

test("phase observer failures cannot lose a valid result or trigger fallback", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const broken = () => { throw new Error("observer"); };
  const loading = loadCompleteCatalogData({ ...h.options, phaseRecorder: { startPhase: broken, endPhase: broken, recordRequest: broken } });
  h.calls[0].response.resolve(Response.json(payload("api")));
  assert.equal((await loading).source, "api");
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test("native fetch abandons an unfinished API body after R2 wins", { timeout: 5000 }, async (t) => {
  const apiClosed = deferred<void>();
  const requested: string[] = [];
  const server = createServer((request, response) => {
    requested.push(request.url!);
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/api/catalog/ja") {
      response.on("close", () => apiClosed.resolve());
      response.write('{"data":[');
      return;
    }
    response.end(JSON.stringify(payload("r2")));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const result = await loadCompleteCatalogData({
    lang: "ja", catalogUrl: `${base}/api/catalog/ja`, r2BaseUrl: base,
    hedgeDelayMs: 50, timeoutMs: 2000,
  });
  assert.equal(result.source, "r2");
  assert.equal(result.items[0].id, "r2");
  await apiClosed.promise;
  assert.deepEqual(requested, ["/api/catalog/ja", "/data/akyo-data-ja.json"]);
});
