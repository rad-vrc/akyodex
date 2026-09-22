import assert from "node:assert/strict";
import test from "node:test";
import { readCatalogServerTiming, withCatalogServerTiming, withCatalogWorkerTiming } from "./catalog-diagnostics";
import { withWorkerResponseHeaders } from "./worker-version-headers";

test("catalog diagnostics preserve status, body, cache validators and existing Server-Timing", async () => {
  for (const status of [200, 304, 500]) {
    const original = new Response(status === 304 ? null : "body", {
      status, headers: { ETag: '"revision"', "Cache-Control": "public, max-age=60", "Server-Timing": "other;dur=4" },
    });
    const timed = await withCatalogWorkerTiming(new Request("https://example.com/api/catalog/ja"), async () =>
      withCatalogServerTiming(original, { durationsMs: { catalog_kv: 8000 }, generatedAt: 1000 }));
    const response = withWorkerResponseHeaders(timed, { id: "version", tag: "abcdef" }, "production");
    assert.equal(response.bodyUsed, false);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("ETag"), '"revision"');
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    assert.match(response.headers.get("Server-Timing") ?? "", /other;dur=4/);
    assert.match(response.headers.get("Server-Timing") ?? "", /akyodex-version/);
    const timing = readCatalogServerTiming(response.headers);
    assert.equal(timing.durationsMs.catalog_kv, 8000);
    assert.equal(timing.generatedAt, 1000, "a cached handler timestamp must not be refreshed by the wrapper");
    assert.ok(timing.workerGeneratedAt! > timing.generatedAt!);
    assert.match(timing.responseId ?? "", /^[a-f0-9-]{36}$/);
    assert.equal(await response.text(), status === 304 ? "" : "body");
  }
});

test("worker timing leaves other routes and non-GET requests untouched", async () => {
  for (const [method, path] of [["GET", "/api/admin/catalog"], ["POST", "/api/catalog/ja"], ["GET", "/zukan"]]) {
    const response = new Response("ok");
    const result = await withCatalogWorkerTiming(new Request(`https://example.com${path}`, { method }), async () => response);
    assert.ok(result === response);
  }
});

test("only bounded catalog timings cross the telemetry boundary", () => {
  const headers = new Headers({
    "Server-Timing": 'secret;desc="private", catalog_kv;dur=-1, catalog_load;dur=Infinity, catalog_source;desc="private", catalog_generated;desc="1000", catalog_request;desc="private", catalog_worker;dur=2.5',
    Age: "30", "Set-Cookie": "private=secret",
  });
  assert.deepEqual(readCatalogServerTiming(headers), { durationsMs: { catalog_worker: 2.5 }, generatedAt: 1000, ageSeconds: 30 });
  headers.set("Server-Timing", "x".repeat(8193));
  assert.deepEqual(readCatalogServerTiming(headers), { durationsMs: {} });
});
