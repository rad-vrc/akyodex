import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import ts from "typescript";
import type { loadCompleteCatalogData } from "../src/app/zukan/catalog-data-loader";
import type { CatalogRequestTiming } from "../src/lib/catalog-diagnostics";
import { serializeCatalogPayload } from "../src/lib/catalog-payload";

declare global {
  interface Window { transportLoader: typeof loadCompleteCatalogData; baselineLoader: typeof loadCompleteCatalogData }
}

type Scenario = "normal" | "cache" | "headers" | "body";
// Generate the compact API body from tracked data; no build output is required.
const r2Text = readFileSync("data/akyo-data-ja.json", "utf8");
const compression = { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } };
let apiBytes: Buffer;
const apiFixture = process.env.CATALOG_BENCHMARK_API_BR;
const r2Fixture = process.env.CATALOG_BENCHMARK_R2_BR;
const r2Bytes = r2Fixture ? readFileSync(r2Fixture) : brotliCompressSync(r2Text, compression);
const baselineRef = process.env.CATALOG_BENCHMARK_BASE_REF;
const baselineSource = baselineRef
  ? execFileSync("git", ["show", `${baselineRef}:src/app/zukan/catalog-data-loader.ts`], { encoding: "utf8" })
  : undefined;
const smallPayload = (revision: number) => ({ data: [{ id: `cache-${revision}`, avatarName: "Cache", nickname: "Cache" }] });
const state = {
  scenario: "normal" as Scenario, revision: 1,
  requests: [] as { source: string; conditional?: string; status: number }[],
  held: undefined as ServerResponse | undefined,
  timers: new Set<ReturnType<typeof setTimeout>>(),
};
let origin: string;
let r2Origin: string;

function catalogResponse(source: "api" | "r2", request: import("node:http").IncomingMessage, response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const record = { source, conditional: request.headers["if-none-match"], status: 200 };
  state.requests.push(record);
  if (state.scenario === "cache") {
    if (source === "api") { record.status = 503; response.writeHead(503).end(); return; }
    const etag = `"revision-${state.revision}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Last-Modified", new Date(Date.now() - 86_400_000).toUTCString());
    // No explicit freshness, matching the R2 response under review.
    if (record.conditional === etag) { record.status = 304; response.writeHead(304).end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(smallPayload(state.revision)));
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (source === "api" && state.scenario === "body") {
    state.held = response;
    response.write('{"data":[');
    return;
  }
  const send = () => {
    response.setHeader("Content-Encoding", "br");
    response.end(source === "api" ? apiBytes : r2Bytes);
  };
  if (source === "api" && state.scenario === "headers") {
    const timer = setTimeout(() => { state.timers.delete(timer); if (!response.destroyed) send(); }, 8000);
    state.timers.add(timer);
  } else send();
}

const apiServer = createServer((request, response) => {
  const pathname = new URL(request.url!, "http://localhost").pathname;
  if (pathname === "/api/catalog/ja") { catalogResponse("api", request, response); return; }
  if (pathname === "/sw.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(readFileSync("public/sw.js"));
    return;
  }
  if (pathname === "/baseline-loader.js" && baselineSource) {
    response.setHeader("Content-Type", "application/javascript");
    response.end(ts.transpileModule(baselineSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    return;
  }
  if (pathname.startsWith("/src/")) {
    const filename = path.resolve(`.${pathname.endsWith(".ts") ? pathname : `${pathname}.ts`}`);
    if (!filename.startsWith(path.resolve("src") + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", "application/javascript");
    response.end(ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><script type="importmap">{"imports":{"@/":"/src/"}}</script><script type="module">import {loadCompleteCatalogData} from "/src/app/zukan/catalog-data-loader.ts"; window.transportLoader = loadCompleteCatalogData;</script>');
});
const r2Server = createServer((request, response) => catalogResponse("r2", request, response));

test.beforeAll(async () => {
  const { text } = await serializeCatalogPayload("ja", JSON.parse(r2Text).data);
  apiBytes = apiFixture ? readFileSync(apiFixture) : brotliCompressSync(text, compression);
  for (const bytes of [apiBytes, r2Bytes]) expect(JSON.parse(brotliDecompressSync(bytes).toString()).data.length).toBeGreaterThan(12);
  for (const server of [apiServer, r2Server]) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  const url = (server: typeof apiServer) => `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  origin = url(apiServer);
  r2Origin = url(r2Server);
});

function reset(scenario: Scenario) {
  for (const timer of state.timers) clearTimeout(timer);
  state.timers.clear();
  state.held?.destroy();
  state.held = undefined;
  state.scenario = scenario;
  state.requests = [];
}

test.afterAll(async () => {
  reset("normal");
  for (const server of [apiServer, r2Server]) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function open(page: Page) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.transportLoader === "function");
}

test("R2 revalidates a heuristically fresh browser cache, including unchanged 304 responses", async ({ page }) => {
  reset("cache");
  state.revision = 1;
  await open(page);
  const url = `${r2Origin}/data/akyo-data-ja.json`;
  expect(await page.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, url)).toBe("cache-1");
  state.revision = 2;
  // Control: default fetch still uses the old locally fresh representation.
  expect(await page.evaluate(async (url) => (await (await fetch(url)).json()).data[0].id, url)).toBe("cache-1");
  expect(state.requests.filter((entry) => entry.source === "r2")).toHaveLength(1);
  const load = () => page.evaluate(async (base) => {
    const result = await window.transportLoader({ lang: "ja", catalogUrl: "/api/catalog/ja", r2BaseUrl: base });
    return { source: result.source, id: result.items[0].id };
  }, r2Origin);
  expect(await load()).toEqual({ source: "r2", id: "cache-2" });
  expect(await load()).toEqual({ source: "r2", id: "cache-2" });
  expect(state.requests.filter((entry) => entry.source === "r2")).toEqual([
    { source: "r2", status: 200, conditional: undefined },
    { source: "r2", status: 200, conditional: '"revision-1"' },
    { source: "r2", status: 304, conditional: '"revision-2"' },
  ]);
});

for (const { serviceWorker, preload } of [
  { serviceWorker: false, preload: false },
  { serviceWorker: false, preload: true },
  { serviceWorker: true, preload: false },
  { serviceWorker: true, preload: true },
]) {
  test(`an unfinished API body does not block the winner (service worker: ${serviceWorker}, preload: ${preload})`, async ({ page }, testInfo) => {
    reset("body");
    await open(page);
    if (serviceWorker) {
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    }
    let routedThroughWorker = false;
    page.on("response", (response) => {
      if (response.url().includes("/api/catalog/ja")) routedThroughWorker = response.fromServiceWorker();
    });
    if (preload) {
      await page.evaluate(() => {
        const link = document.createElement("link");
        link.rel = "preload"; link.as = "fetch"; link.crossOrigin = "anonymous";
        link.href = "/api/catalog/ja"; document.head.append(link);
      });
      await expect.poll(() => state.held !== undefined).toBe(true);
    }
    const observed = await page.evaluate(async (base) => {
      const timings: CatalogRequestTiming[] = [];
      const result = await window.transportLoader({
        lang: "ja", catalogUrl: "/api/catalog/ja", r2BaseUrl: base,
        hedgeDelayMs: 100, bodyIdleTimeoutMs: 100,
        phaseRecorder: { startPhase() {}, endPhase() {}, recordRequest: (value) => timings.push(value) },
      });
      return { source: result.source, count: result.items.length, timings };
    }, r2Origin);
    expect(observed.source).toBe("r2");
    expect(observed.count).toBeGreaterThan(12);
    expect(observed.timings.find((timing) => timing.source === "api")).toMatchObject({ outcome: "aborted", abortReason: "superseded" });
    expect(routedThroughWorker).toBe(serviceWorker);
    await page.waitForTimeout(500);
    const closedBeforeCleanup = state.held?.destroyed === true;
    if (!serviceWorker && !preload) expect(closedBeforeCleanup).toBe(true);
    expect(state.requests.filter((request) => request.source === "api")).toHaveLength(1);
    // Record SW network cancellation, not an unsupported cross-browser guarantee.
    await testInfo.attach("api-cancellation", { body: JSON.stringify({ serviceWorker, preload, closedBeforeCleanup }), contentType: "application/json" });
    console.log(JSON.stringify({ serviceWorker, preload, closedBeforeCleanup }));
  });
}

test("manual throttled transport comparison", async ({ browser }, testInfo) => {
  test.skip(process.env.CATALOG_TRANSPORT_BENCHMARK !== "1", "opt-in timing experiment, not a CI performance threshold");
  test.setTimeout(900_000);
  const results: unknown[] = [];
  console.log(JSON.stringify({ browser: browser.version(), fixtures: { api: apiFixture ?? "generated-q4", r2: r2Fixture ?? "generated-q4" }, baselineRef, apiCompressedBytes: apiBytes.length, r2CompressedBytes: r2Bytes.length }));
  const cases = [
    { name: "56kbps", kbps: 56, latency: 300, preload: 0, scenario: "normal" },
    { name: "64kbps", kbps: 64, latency: 300, preload: 0, scenario: "normal" },
    { name: "100kbps", kbps: 100, latency: 300, preload: 0, scenario: "normal" },
    { name: "128kbps", kbps: 128, latency: 300, preload: 0, scenario: "normal" },
    { name: "150kbps", kbps: 150, latency: 300, preload: 0, scenario: "normal" },
    { name: "headers-8s", kbps: 0, latency: 0, preload: 0, scenario: "headers" },
    { name: "body-stall", kbps: 0, latency: 0, preload: 0, scenario: "body" },
  ] as const;
  const policies = baselineSource ? ["6s", "idle", "none"] as const : ["idle", "none"] as const;
  for (const entry of cases) for (const policy of policies) {
    const samples = [];
    for (let round = 0; round < 5; round++) {
      reset(entry.scenario);
      const context = await browser.newContext({ serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        await open(page);
        if (policy === "6s") await page.evaluate(async () => {
          const url = "/baseline-loader.js";
          const baseline = await import(/* webpackIgnore: true */ url);
          window.baselineLoader = baseline.loadCompleteCatalogData;
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false, latency: entry.latency,
          downloadThroughput: entry.kbps ? entry.kbps * 1000 / 8 : -1,
          uploadThroughput: entry.kbps ? entry.kbps * 1000 / 8 : -1,
        });
        if (entry.preload) {
          await page.evaluate(() => {
            const link = document.createElement("link");
            link.rel = "preload"; link.as = "fetch"; link.crossOrigin = "anonymous";
            link.href = "/api/catalog/ja"; document.head.append(link);
          });
          await page.waitForTimeout(entry.preload);
        }
        const sample = await page.evaluate(async ({ base, policy }) => {
          const started = performance.now();
          const timings: CatalogRequestTiming[] = [];
          try {
            const loader = policy === "6s" ? window.baselineLoader : window.transportLoader;
            const result = await loader({
              lang: "ja", catalogUrl: "/api/catalog/ja", r2BaseUrl: base,
              hedgeDelayMs: policy === "none" ? 20_000 : 2000,
              bodyIdleTimeoutMs: policy === "none" ? 20_000 : 3000,
              phaseRecorder: { startPhase() {}, endPhase() {}, recordRequest: (value) => timings.push(value) },
            });
            return { duration: Math.round(performance.now() - started), source: result.source, timings };
          } catch (error) {
            return { duration: Math.round(performance.now() - started), error: (error as Error).name, timings };
          }
        }, { base: r2Origin, policy });
        if (policy === "6s" && "error" in sample) {
          // Preserve a baseline failure as evidence, rather than aborting the comparison.
          expect(sample.error).toBe("CatalogDeadlineError");
        } else if (entry.scenario === "body" && policy === "none") {
          expect(sample).toMatchObject({ error: "CatalogDeadlineError" });
        } else {
          expect(sample).toMatchObject({ source: entry.scenario === "normal" || policy === "none" ? "api" : "r2" });
        }
        if (entry.scenario === "normal" && policy !== "6s") expect(state.requests.map((request) => request.source)).toEqual(["api"]);
        samples.push({ ...sample, requestSources: state.requests.map((request) => request.source) });
      } finally { await context.close(); }
    }
    const result = { case: entry.name, policy, medianMs: samples.map((sample) => sample.duration).sort((a, b) => a - b)[2], samples };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await testInfo.attach("transport-comparison", { body: JSON.stringify({ browser: browser.version(), apiCompressedBytes: apiBytes.length, r2CompressedBytes: r2Bytes.length, results }, null, 2), contentType: "application/json" });
});

test("manual throttled retry succeeds after a shared deadline, without preload", async ({ page, context }) => {
  test.skip(process.env.CATALOG_TRANSPORT_BENCHMARK !== "1", "opt-in slow network experiment");
  test.setTimeout(40_000);
  reset("normal");
  await open(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 300, downloadThroughput: 56 * 1000 / 8, uploadThroughput: 56 * 1000 / 8,
  });
  const observed = await page.evaluate(async (base) => {
    const options = { lang: "ja" as const, catalogUrl: "/api/catalog/ja", r2BaseUrl: base };
    let firstError: string | undefined;
    try { await window.transportLoader({ ...options, timeoutMs: 1000 }); }
    catch (error) { firstError = (error as Error).name; }
    const started = performance.now();
    const retried = await window.transportLoader(options);
    return { firstError, source: retried.source, count: retried.items.length, retryMs: Math.round(performance.now() - started) };
  }, r2Origin);
  expect(observed).toMatchObject({ firstError: "CatalogDeadlineError", source: "api" });
  expect(observed.count).toBeGreaterThan(12);
  expect(state.requests.map((request) => request.source)).toEqual(["api", "api"]);
  console.log(JSON.stringify({ case: "56kbps-retry", ...observed }));
});
