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
  let time = 0;
  const timers = new Map<ReturnType<typeof setTimeout>, { delay: number; due: number; run: () => void }>();
  const scheduled: number[] = [];
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) => {
    const handle = realSetTimeout(() => {}, 60_000);
    handle.unref();
    timers.set(handle, { delay, due: time + delay, run: callback });
    scheduled.push(delay);
    return handle;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", (handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle);
    realClearTimeout(handle);
  });
  const calls: { url: string; signal: AbortSignal; init?: RequestInit; response: ReturnType<typeof deferred<Response>> }[] = [];
  const requests: CatalogRequestTiming[] = [];
  const phases: string[] = [];
  const controller = new AbortController();
  const options = {
    lang: "ja" as const, catalogUrl: "/api/catalog/ja", r2BaseUrl: "https://images.example.com",
    signal: controller.signal, now: () => time,
    fetchImpl: (async (url, init) => {
      const response = deferred<Response>();
      calls.push({ url: String(url), signal: init!.signal!, init, response });
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
    async advance(value: number) {
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= value).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        time = next[1].due;
        timers.delete(next[0]);
        realClearTimeout(next[0]);
        next[1].run();
        await setImmediate();
      }
      time = value;
    },
    fire(delay: number) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `missing ${delay}ms timer`);
      timers.delete(entry[0]);
      realClearTimeout(entry[0]);
      entry[1].run();
    },
  };
}

function streamedBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  }));
  return { response, controller, isCancelled: () => cancelled };
}

test("a continuously arriving API body finishes at twelve seconds without a competing R2 download", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = streamedBody();
  const loading = loadCompleteCatalogData(h.options);
  void loading.catch(() => {});
  h.calls[0].response.resolve(body.response);
  await setImmediate();
  const text = JSON.stringify(payload("slow-api"));
  for (let part = 0; part < 12; part++) {
    await h.advance((part + 1) * 1000);
    body.controller.enqueue(new TextEncoder().encode(text.slice(Math.floor(part * text.length / 12), Math.floor((part + 1) * text.length / 12))));
    await setImmediate();
    assert.equal(h.calls.length, 1, `progress at ${(part + 1) * 1000}ms must not start R2`);
  }
  body.controller.close();
  assert.equal((await loading).items[0].id, "slow-api");
  assert.equal(h.timers.size, 0);
});

test("body idle time restarts only on bytes, then cancels the stalled reader after R2 wins", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = streamedBody();
  const loading = loadCompleteCatalogData(h.options);
  void loading.catch(() => {});
  h.calls[0].response.resolve(body.response);
  await setImmediate();
  await h.advance(2500);
  body.controller.enqueue(new TextEncoder().encode('{"data":['));
  await setImmediate();
  await h.advance(5000);
  body.controller.enqueue(new Uint8Array());
  await setImmediate();
  await h.advance(5499);
  assert.equal(h.calls.length, 1);
  await h.advance(5500);
  assert.equal(h.calls.length, 2, "three idle seconds after the last non-empty chunk start R2");
  h.calls[1].response.resolve(Response.json(payload("r2")));
  assert.equal((await loading).source, "r2");
  await setImmediate();
  assert.equal(body.isCancelled(), true);
  assert.equal(h.requests.find((request) => request.source === "r2")?.startOffsetMs, 5500);
  assert.equal(h.timers.size, 0);
});

test("streamed JSON preserves split UTF-8 characters and a split BOM", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = streamedBody();
  const loading = loadCompleteCatalogData(h.options);
  h.calls[0].response.resolve(body.response);
  const bytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(payload("分割한글"))}`);
  for (const byte of bytes) body.controller.enqueue(Uint8Array.of(byte));
  body.controller.close();
  assert.equal((await loading).items[0].avatarName, "分割한글");
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

for (const fault of ["stream-error", "invalid-json", "empty-body"] as const) {
  test(`${fault} starts R2 immediately rather than waiting for idle`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const body = streamedBody();
    const loading = loadCompleteCatalogData(h.options);
    h.calls[0].response.resolve(body.response);
    await setImmediate();
    if (fault === "stream-error") body.controller.error(new Error("connection reset"));
    else {
      if (fault === "invalid-json") body.controller.enqueue(new TextEncoder().encode('{"data":['));
      body.controller.close();
    }
    await setImmediate();
    assert.equal(h.calls.length, 2);
    h.calls[1].response.resolve(Response.json(payload("r2")));
    assert.equal((await loading).source, "r2");
    assert.equal(h.requests.find((request) => request.source === "r2")?.trigger, "fallback");
    assert.equal(h.timers.size, 0);
  });
}

for (const finish of ["caller", "deadline"] as const) {
  test(`${finish} cancels an actual streamed reader even while bytes are progressing`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const body = streamedBody();
    const loading = loadCompleteCatalogData(h.options);
    const rejected = assert.rejects(loading, { name: finish === "caller" ? "AbortError" : "CatalogDeadlineError" });
    h.calls[0].response.resolve(body.response);
    await setImmediate();
    for (let second = 1; second < 15; second++) {
      await h.advance(second * 1000);
      body.controller.enqueue(Uint8Array.of(32));
      await setImmediate();
    }
    if (finish === "caller") h.controller.abort();
    else await h.advance(15000);
    await rejected;
    await setImmediate();
    assert.equal(h.calls.length, 1);
    assert.equal(body.isCancelled(), true);
    assert.equal(h.timers.size, 0);
  });
}

test("progress after a failed R2 hedge cannot schedule another hedge", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = streamedBody();
  const loading = loadCompleteCatalogData(h.options);
  await h.advance(2000);
  h.calls[1].response.resolve(Response.json({}, { status: 503 }));
  await setImmediate();
  h.calls[0].response.resolve(body.response);
  await setImmediate();
  body.controller.enqueue(new TextEncoder().encode(JSON.stringify(payload("api"))));
  await setImmediate();
  assert.equal(h.timers.size, 1, "only the original shared deadline remains");
  body.controller.close();
  assert.equal((await loading).source, "api");
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
});

test("fast API keeps the preload conditions and clears the unused hedge timer", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  h.calls[0].response.resolve(Response.json(payload("api")));
  assert.equal((await loading).source, "api");
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].init, { signal: h.calls[0].signal });
  assert.deepEqual(h.scheduled, [15000, 2000, 3000, 3000]);
  assert.equal(h.timers.size, 0);
});

test("only R2 revalidates its browser cache; API preload and snapshot options stay unchanged", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const loading = loadCompleteCatalogData(h.options);
  for (let index = 0; index < 2; index++) {
    h.calls[index].response.resolve(Response.json({}, { status: 503 }));
    await setImmediate();
  }
  h.calls[2].response.resolve(Response.json(payload("snapshot")));
  await loading;
  assert.deepEqual(h.calls.map((call) => call.init), [
    { signal: h.calls[0].signal },
    { signal: h.calls[1].signal, cache: "no-cache" },
    { signal: h.calls[2].signal },
  ]);
});

for (const winner of ["api", "r2"] as const) {
  test(`${winner} claims a simultaneous body completion before the loser normalizes or records success`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const bodies = [deferred<unknown>(), deferred<unknown>()];
    const loading = loadCompleteCatalogData(h.options);
    h.fire(2000);
    for (let index = 0; index < 2; index++) {
      // Isolate the validation race from stream scheduling; stream cancellation is tested separately.
      const response = new Response(null);
      response.json = () => bodies[index].promise;
      h.calls[index].response.resolve(response);
    }
    await setImmediate();
    const first = winner === "api" ? 0 : 1;
    bodies[first].resolve(payload(winner));
    bodies[1 - first].resolve(payload("loser"));
    assert.equal((await loading).source, winner);
    await setImmediate();
    assert.deepEqual(h.phases, ["start:normalize", "end:normalize"]);
    assert.equal(h.requests.filter((request) => request.outcome === "success").length, 1);
    assert.equal(h.requests.find((request) => request.source !== winner)?.abortReason, "superseded");
  });
}

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
      const response = new Response(null);
      response.json = () => body.promise;
      h.calls[0].response.resolve(response);
      await setImmediate();
    }
    if (stalledAt === "body") {
      await h.advance(2999);
      assert.equal(h.calls.length, 1, "wait for three idle seconds after headers");
      await h.advance(3000);
    } else {
      h.time(2000);
      h.fire(2000);
    }
    assert.equal(h.calls.length, 2);
    assert.match(h.calls[1].url, /akyo-data-ja.json$/);
    h.time(stalledAt === "body" ? 3500 : 2500);
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
    assert.equal(r2Timing.startOffsetMs, stalledAt === "body" ? 3000 : 2000);
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

test("headers near the initial hedge deadline start a fresh idle window", { timeout: 2000 }, async (t) => {
  const h = harness(t);
  const body = deferred<unknown>();
  const loading = loadCompleteCatalogData(h.options);
  void loading.catch(() => {});
  const response = new Response(null);
  response.json = () => body.promise;
  h.time(1900);
  h.calls[0].response.resolve(response);
  await setImmediate();
  await h.advance(4000);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.scheduled, [15000, 2000, 3000]);
  body.resolve(payload("api"));
  assert.equal((await loading).source, "api");
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

for (const finish of ["body-error", "caller-abort", "deadline"] as const) {
  test(`${finish} cancels a deferred body hedge without extending the load budget`, { timeout: 2000 }, async (t) => {
    const h = harness(t);
    const body = deferred<unknown>();
    const loading = loadCompleteCatalogData({ ...h.options, timeoutMs: 2500 });
    void loading.catch(() => {});
    const response = new Response(null);
    response.json = () => body.promise;
    h.calls[0].response.resolve(response);
    await setImmediate();
    await h.advance(2000);
    assert.equal(h.calls.length, 1);
    if (finish === "body-error") {
      h.time(2400);
      body.reject(new Error("body interrupted"));
      await setImmediate();
      assert.equal(h.calls.length, 2);
      h.calls[1].response.resolve(Response.json(payload("r2")));
      assert.equal((await loading).source, "r2");
      assert.equal(h.requests.find((request) => request.source === "r2")?.trigger, "fallback");
    } else {
      const rejected = assert.rejects(loading, { name: finish === "deadline" ? "CatalogDeadlineError" : "AbortError" });
      if (finish === "deadline") { h.time(2500); h.fire(2500); }
      else h.controller.abort();
      await rejected;
      assert.equal(h.calls.length, 1);
    }
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls[0].signal.aborted, true);
  });
}

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
  const response = new Response(null);
  response.json = () => body.promise;
  const loading = loadCompleteCatalogData(h.options);
  const rejected = assert.rejects(loading, { name: "CatalogDeadlineError" });
  h.calls[0].response.resolve(response);
  await setImmediate();
  await h.advance(3000);
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
    hedgeDelayMs: 50, bodyIdleTimeoutMs: 50, timeoutMs: 2000,
  });
  assert.equal(result.source, "r2");
  assert.equal(result.items[0].id, "r2");
  await apiClosed.promise;
  assert.deepEqual(requested, ["/api/catalog/ja", "/data/akyo-data-ja.json"]);
});
