import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const reportingModulePath = path.join(
  process.cwd(),
  "src",
  "lib",
  "web-vitals-reporting.ts",
);

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

  assert.match(instrumentation, /enableMetrics:\s*true/);
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
    ["deploy-cloudflare-pages.yml", "production"],
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
