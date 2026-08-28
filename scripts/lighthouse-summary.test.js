const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const summaryModulePath = path.join(
  process.cwd(),
  "scripts",
  "lighthouse-summary.js",
);

function createRun({ score, fcp, lcp, tbt, cls, speedIndex }) {
  return {
    categories: { performance: { score } },
    audits: {
      "first-contentful-paint": { numericValue: fcp },
      "largest-contentful-paint": { numericValue: lcp },
      "total-blocking-time": { numericValue: tbt },
      "cumulative-layout-shift": { numericValue: cls },
      "speed-index": { numericValue: speedIndex },
    },
  };
}

test("summarizes three Lighthouse runs by metric median", () => {
  assert.equal(
    existsSync(summaryModulePath),
    true,
    "lighthouse-summary.js must define the CI summary contract",
  );
  const { summarizeLighthouseRuns } = require("./lighthouse-summary");
  assert.equal(typeof summarizeLighthouseRuns, "function");

  const summary = summarizeLighthouseRuns([
    createRun({ score: 0.8, fcp: 1_100, lcp: 5_100, tbt: 100, cls: 0.01, speedIndex: 3_000 }),
    createRun({ score: 0.7, fcp: 1_300, lcp: 5_300, tbt: 200, cls: 0.02, speedIndex: 3_200 }),
    createRun({ score: 0.6, fcp: 1_200, lcp: 5_200, tbt: 150, cls: 0.03, speedIndex: 3_100 }),
  ]);

  assert.deepEqual(summary, {
    runCount: 3,
    performanceScore: 70,
    firstContentfulPaintMs: 1_200,
    largestContentfulPaintMs: 5_200,
    totalBlockingTimeMs: 150,
    cumulativeLayoutShift: 0.02,
    speedIndexMs: 3_100,
  });
});

test("evaluates only median values against Lighthouse budgets", () => {
  assert.equal(existsSync(summaryModulePath), true);
  const { evaluateLighthouseBudgets } = require("./lighthouse-summary");
  assert.equal(typeof evaluateLighthouseBudgets, "function");

  const passingSummary = {
    runCount: 3,
    performanceScore: 70,
    firstContentfulPaintMs: 1_700,
    largestContentfulPaintMs: 5_200,
    totalBlockingTimeMs: 200,
    cumulativeLayoutShift: 0.02,
    speedIndexMs: 4_600,
  };
  assert.deepEqual(evaluateLighthouseBudgets(passingSummary), []);

  assert.deepEqual(
    evaluateLighthouseBudgets({
      ...passingSummary,
      performanceScore: 49,
      largestContentfulPaintMs: 8_001,
      totalBlockingTimeMs: 601,
    }),
    [
      "Performance score 49 is below 50",
      "Largest Contentful Paint 8001ms exceeds 8000ms",
      "Total Blocking Time 601ms exceeds 600ms",
    ],
  );
});

test("Lighthouse CI pins the PageSpeed engine and uses three simulated runs", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  );
  const workflowPath = path.join(
    process.cwd(),
    ".github",
    "workflows",
    "lighthouse-ci.yml",
  );

  assert.equal(packageJson.devDependencies?.lighthouse, "13.4.1");
  assert.equal(existsSync(workflowPath), true);

  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /for run in 1 2 3/);
  assert.match(workflow, /--throttling-method=simulate/);
  assert.match(workflow, /scripts\/lighthouse-summary\.js/);
});
