import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as diagnostics from "./catalog-diagnostics";
import * as versionHeaders from "./worker-version-headers";

const source = readFileSync(new URL("../../cloudflare-worker.ts", import.meta.url), "utf8");
const env = {
  CF_VERSION_METADATA: { id: "test-version", tag: "test-revision" },
  AKYODEX_DEPLOYMENT_ENVIRONMENT: "production",
};
const context = {};
type WorkerFetch = (request: Request, runtimeEnv: typeof env, ctx: typeof context) => Promise<Response>;

function loadWorker(fetch: WorkerFetch) {
  const exports: { default?: { fetch: WorkerFetch } } = {};
  const dependencies: Record<string, unknown> = {
    "@sentry/cloudflare": { withSentry: (_options: unknown, handler: unknown) => handler },
    "./.open-next/worker.js": { default: { fetch }, DOQueueHandler: class {} },
    "./src/lib/worker-version-headers": versionHeaders,
    "./src/lib/catalog-diagnostics": diagnostics,
  };
  // Evaluate the real entrypoint, keeping both response wrappers real.
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  assert.ok(exports.default);
  return exports.default;
}

for (const status of [200, 304, 500]) {
  test(`actual Worker entry attaches catalog timing without changing a ${status} response`, async () => {
    for (const language of ["ja", "en", "ko"]) {
      const request = new Request(`https://example.com/api/catalog/${language}`);
      let calls = 0;
      const worker = loadWorker(async (receivedRequest, receivedEnv, receivedContext) => {
        calls += 1;
        assert.ok(receivedRequest === request);
        assert.ok(receivedEnv === env);
        assert.ok(receivedContext === context);
        return new Response(status === 304 ? null : "catalog-body", {
          status,
          headers: {
            ETag: '"catalog-revision"',
            "Cache-Control": "public, max-age=60",
            "Server-Timing": 'catalog_kv;dur=8, catalog_generated;desc="1000"',
          },
        });
      });
      const response = await worker.fetch(request, env, context);
      const timing = diagnostics.readCatalogServerTiming(response.headers);
      assert.equal(calls, 1);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("ETag"), '"catalog-revision"');
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
      assert.equal(response.headers.get("X-Akyodex-Worker-Tag"), "test-revision");
      assert.equal(response.headers.get("X-Akyodex-Worker-Version"), "test-version");
      assert.equal(timing.durationsMs.catalog_kv, 8);
      assert.equal(timing.generatedAt, 1000);
      assert.ok(typeof timing.durationsMs.catalog_worker === "number", "the real entry must attach Worker timing");
      assert.ok(timing.workerGeneratedAt! > 1000);
      assert.match(timing.responseId ?? "", /^[a-f0-9-]{36}$/);
      assert.equal(await response.text(), status === 304 ? "" : "catalog-body");
    }
  });
}

test("actual Worker entry leaves other routes and methods free of catalog timing", async () => {
  for (const [method, path] of [["GET", "/zukan"], ["GET", "/api/admin/catalog"], ["POST", "/api/catalog/ja"]]) {
    let calls = 0;
    const worker = loadWorker(async () => {
      calls += 1;
      return new Response("unchanged");
    });
    const response = await worker.fetch(new Request(`https://example.com${path}`, { method }), env, context);
    assert.equal(calls, 1);
    assert.deepEqual(diagnostics.readCatalogServerTiming(response.headers), { durationsMs: {} });
    assert.equal(response.headers.get("X-Akyodex-Worker-Tag"), "test-revision");
    assert.equal(await response.text(), "unchanged");
  }
});
