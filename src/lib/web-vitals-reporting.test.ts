import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as reporting from "./web-vitals-reporting";
import { createInpDiagnostics } from "./web-vitals-reporting";

const reportingModulePath = path.join(
  process.cwd(),
  "src",
  "lib",
  "web-vitals-reporting.ts",
);

test("INP diagnostics report event phases without text, selectors or input values", () => {
  const entry = { entryType: "event", name: "click", interactionId: 7,
    startTime: 100, processingStart: 300, processingEnd: 650, duration: 752,
    target: { tagName: "BUTTON", id: "private-id", textContent: "private text", value: "private search" } };
  const result = createInpDiagnostics({ name: "INP", entries: [entry] });
  assert.deepEqual(result, { inp_events: [{
    event_type: "click", interaction_id: 7, target_tag: "button",
    start_time_ms: 100, duration_ms: 752, input_delay_ms: 200,
    handler_duration_ms: 350, presentation_delay_ms: 202,
  }] });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("INP diagnostics handle removed targets and rounded durations without negative phases", () => {
  assert.deepEqual(createInpDiagnostics({ name: "INP", entries: [
    { entryType: "event", name: "keydown", interactionId: 14,
      startTime: 50, processingStart: 52, processingEnd: 68, duration: 16, target: null },
  ] }), { inp_events: [{
    event_type: "keydown", interaction_id: 14, target_tag: "unknown",
    start_time_ms: 50, duration_ms: 16, input_delay_ms: 2,
    handler_duration_ms: 16, presentation_delay_ms: 0,
  }] });
});

test("INP diagnostics are bounded, retain event order and ignore unsupported entries", () => {
  const entry = { entryType: "event", name: "pointerdown", interactionId: 1,
    startTime: 100, processingStart: 110, processingEnd: 130, duration: 40,
    target: { tagName: "USER-PRIVATE-COMPONENT" } };
  assert.equal(createInpDiagnostics({ name: "LCP", entries: [entry] }), undefined);
  assert.equal(createInpDiagnostics({ name: "INP" }), undefined);
  assert.equal(createInpDiagnostics({ name: "INP", entries: [null, {},
    { ...entry, duration: NaN }, { ...entry, processingEnd: 99 }] }), undefined);
  const result = createInpDiagnostics({ name: "INP", entries: Array.from({ length: 20 },
    (_, i) => ({ ...entry, startTime: 100 + i })) })!;
  assert.equal(result.inp_events.length, 8);
  assert.equal(result.inp_events[0].target_tag, "other");
  assert.equal(result.inp_events[7].start_time_ms, 107);
});

test("the production WebVitals callback attaches phases to the existing poor alert only", () => {
  const messages: { message: string; options: { extra: Record<string, unknown> } }[] = [];
  const distributions: unknown[][] = [];
  let report: (metric: Record<string, unknown>) => void = () => assert.fail("callback not registered");
  const exports: { WebVitals?: () => void } = {};
  const source = readFileSync(path.join(process.cwd(), "src/components/web-vitals.tsx"), "utf8");
  const dependencies: Record<string, unknown> = {
    "@/lib/web-vitals-reporting": reporting,
    "@/lib/sentry-browser": {
      captureMessageSafely: (message: string, options: { extra: Record<string, unknown> }) => messages.push({ message, options }),
      captureDistributionSafely: (...args: unknown[]) => distributions.push(args),
    },
    "next/web-vitals": { useReportWebVitals: (callback: typeof report) => { report = callback; } },
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, process: { env: { NODE_ENV: "production" } },
    document: { documentElement: { lang: "ja" } }, window: { location: { pathname: "/zukan" } },
    performance: { getEntriesByType: () => [{ serverTiming: [{ name: "akyodex-version", description: "test-sha" }] }] },
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  exports.WebVitals!();
  const metric = { name: "INP", value: 752, rating: "poor", navigationType: "navigate",
    entries: [{ entryType: "event", name: "click", interactionId: 1,
      startTime: 0, processingStart: 200, processingEnd: 400, duration: 752, target: null }] };
  report(metric);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "Web Vitals degraded: INP");
  assert.equal(messages[0].options.extra.workerVersion, "test-sha");
  assert.deepEqual(messages[0].options.extra.inp_events, createInpDiagnostics(metric)!.inp_events);
  report({ ...metric, rating: "good" });
  assert.equal(messages.length, 1, "good interactions must not create extra issues");
  report({ ...metric, name: "LCP" });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].options.extra.inp_events, undefined);
  assert.equal(distributions.length, 3, "distribution reporting is unchanged");
});

test("creates Sentry distributions for Core Web Vitals", async () => {
  assert.equal(
    existsSync(reportingModulePath),
    true,
    "web-vitals-reporting.ts must define the reporting contract",
  );

  const reportingModule = await import("./web-vitals-reporting");
  assert.equal(typeof reportingModule.createWebVitalDistribution, "function");

  assert.deepEqual(
    reportingModule.createWebVitalDistribution(
      {
        name: "LCP",
        value: 2_024,
        rating: "good",
        navigationType: "navigate",
      },
      {
        language: "ja",
        pathname: "/zukan",
        workerVersion: "git-sha",
      },
    ),
    {
      name: "web_vitals.lcp",
      value: 2_024,
      unit: "millisecond",
      attributes: {
        language: "ja",
        navigation_type: "navigate",
        page: "/zukan",
        rating: "good",
        worker_version: "git-sha",
      },
    },
  );

  assert.deepEqual(
    reportingModule.createWebVitalDistribution(
      {
        name: "CLS",
        value: 0.0174,
        rating: "good",
        navigationType: "navigate",
      },
      {
        language: "en",
        pathname: "/zukan",
      },
    ),
    {
      name: "web_vitals.cls",
      value: 0.0174,
      unit: "none",
      attributes: {
        language: "en",
        navigation_type: "navigate",
        page: "/zukan",
        rating: "good",
      },
    },
  );
});

test("does not create distributions for non-Core Web Vitals", async () => {
  assert.equal(existsSync(reportingModulePath), true);
  const { createWebVitalDistribution } = await import("./web-vitals-reporting");

  assert.equal(
    createWebVitalDistribution(
      {
        name: "FCP",
        value: 1_700,
        rating: "needs-improvement",
        navigationType: "reload",
      },
      {
        language: "ja",
        pathname: "/zukan",
      },
    ),
    null,
  );
});

test("reads the Worker version from navigation Server-Timing entries", async () => {
  assert.equal(existsSync(reportingModulePath), true);
  const { getWorkerVersionFromNavigation } = await import(
    "./web-vitals-reporting"
  );

  assert.equal(
    getWorkerVersionFromNavigation({
      getEntriesByType: () => [
        {
          serverTiming: [
            { name: "cache", description: "hit" },
            { name: "akyodex-version", description: "git-sha" },
          ],
        },
      ],
    }),
    "git-sha",
  );
  assert.equal(
    getWorkerVersionFromNavigation({ getEntriesByType: () => [] }),
    undefined,
  );
});

test("browser Sentry explicitly enables metrics and exposes a safe distribution wrapper", () => {
  const instrumentation = readFileSync(
    path.join(process.cwd(), "instrumentation-client.ts"),
    "utf8",
  );
  const sentryBrowser = readFileSync(
    path.join(process.cwd(), "src", "lib", "sentry-browser.ts"),
    "utf8",
  );
  const webVitals = readFileSync(
    path.join(process.cwd(), "src", "components", "web-vitals.tsx"),
    "utf8",
  );

  // 初期化オプションは src/lib/sentry-client-init.ts に移した（tracing 遅延化に伴う分離）。
  // instrumentation-client.ts は環境変数を渡して初期化を呼ぶだけになった
  const clientInit = readFileSync(
    path.join(process.cwd(), "src", "lib", "sentry-client-init.ts"),
    "utf8",
  );
  assert.match(instrumentation, /initBrowserSentry\(/);
  assert.match(clientInit, /enableMetrics:\s*true/);
  assert.match(instrumentation, /NEXT_PUBLIC_SENTRY_ENVIRONMENT/);
  assert.match(
    sentryBrowser,
    /export function captureDistributionSafely\(/,
  );
  assert.match(sentryBrowser, /if \(!Sentry\.getClient\(\)\)/);
  assert.match(webVitals, /captureDistributionSafely/);
  assert.match(webVitals, /createWebVitalDistribution/);
});

test("build workflows isolate browser telemetry by deployment environment", () => {
  const workflowExpectations = [
    ["lighthouse-ci.yml", "lighthouse-ci"],
    ["deploy-cloudflare-pages-preview.yml", "preview"],
    ["deploy-cloudflare-workers-staging.yml", "staging"],
    ["deploy-cloudflare-workers-production.yml", "production"],
  ] as const;

  for (const [workflowName, environment] of workflowExpectations) {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github", "workflows", workflowName),
      "utf8",
    );
    assert.match(
      workflow,
      new RegExp(
        `NEXT_PUBLIC_SENTRY_ENVIRONMENT:\\s*[\"']?${environment}[\"']?`,
      ),
      `${workflowName} must build browser telemetry for ${environment}`,
    );
  }
});
