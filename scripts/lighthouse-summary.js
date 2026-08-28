const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");

const DEFAULT_BUDGETS = Object.freeze({
  minimumPerformanceScore: 50,
  maximumFirstContentfulPaintMs: 2_500,
  maximumLargestContentfulPaintMs: 8_000,
  maximumTotalBlockingTimeMs: 600,
  maximumCumulativeLayoutShift: 0.05,
  maximumSpeedIndexMs: 7_000,
});

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function auditValue(run, auditName) {
  const value = run.audits?.[auditName]?.numericValue;
  if (!Number.isFinite(value)) {
    throw new Error(`Lighthouse run is missing ${auditName}`);
  }
  return value;
}

function summarizeLighthouseRuns(runs) {
  if (runs.length !== 3) {
    throw new Error(`Expected exactly 3 Lighthouse runs, received ${runs.length}`);
  }

  const performanceScores = runs.map((run) => {
    const score = run.categories?.performance?.score;
    if (!Number.isFinite(score)) {
      throw new Error("Lighthouse run is missing its performance score");
    }
    return score * 100;
  });

  return {
    runCount: runs.length,
    performanceScore: Math.round(median(performanceScores)),
    firstContentfulPaintMs: Math.round(
      median(runs.map((run) => auditValue(run, "first-contentful-paint"))),
    ),
    largestContentfulPaintMs: Math.round(
      median(runs.map((run) => auditValue(run, "largest-contentful-paint"))),
    ),
    totalBlockingTimeMs: Math.round(
      median(runs.map((run) => auditValue(run, "total-blocking-time"))),
    ),
    cumulativeLayoutShift: Number(
      median(
        runs.map((run) => auditValue(run, "cumulative-layout-shift")),
      ).toFixed(4),
    ),
    speedIndexMs: Math.round(
      median(runs.map((run) => auditValue(run, "speed-index"))),
    ),
  };
}

function evaluateLighthouseBudgets(summary, budgets = DEFAULT_BUDGETS) {
  const violations = [];
  if (summary.performanceScore < budgets.minimumPerformanceScore) {
    violations.push(
      `Performance score ${summary.performanceScore} is below ${budgets.minimumPerformanceScore}`,
    );
  }
  if (
    summary.firstContentfulPaintMs > budgets.maximumFirstContentfulPaintMs
  ) {
    violations.push(
      `First Contentful Paint ${summary.firstContentfulPaintMs}ms exceeds ${budgets.maximumFirstContentfulPaintMs}ms`,
    );
  }
  if (
    summary.largestContentfulPaintMs > budgets.maximumLargestContentfulPaintMs
  ) {
    violations.push(
      `Largest Contentful Paint ${summary.largestContentfulPaintMs}ms exceeds ${budgets.maximumLargestContentfulPaintMs}ms`,
    );
  }
  if (summary.totalBlockingTimeMs > budgets.maximumTotalBlockingTimeMs) {
    violations.push(
      `Total Blocking Time ${summary.totalBlockingTimeMs}ms exceeds ${budgets.maximumTotalBlockingTimeMs}ms`,
    );
  }
  if (
    summary.cumulativeLayoutShift > budgets.maximumCumulativeLayoutShift
  ) {
    violations.push(
      `Cumulative Layout Shift ${summary.cumulativeLayoutShift} exceeds ${budgets.maximumCumulativeLayoutShift}`,
    );
  }
  if (summary.speedIndexMs > budgets.maximumSpeedIndexMs) {
    violations.push(
      `Speed Index ${summary.speedIndexMs}ms exceeds ${budgets.maximumSpeedIndexMs}ms`,
    );
  }
  return violations;
}

function renderMarkdownSummary(summary, violations) {
  const status = violations.length === 0 ? "PASS" : "FAIL";
  const rows = [
    ["Performance score", summary.performanceScore],
    ["First Contentful Paint", `${summary.firstContentfulPaintMs} ms`],
    ["Largest Contentful Paint", `${summary.largestContentfulPaintMs} ms`],
    ["Total Blocking Time", `${summary.totalBlockingTimeMs} ms`],
    ["Cumulative Layout Shift", summary.cumulativeLayoutShift],
    ["Speed Index", `${summary.speedIndexMs} ms`],
  ];
  const lines = [
    "## Lighthouse mobile median",
    "",
    `Result: **${status}** (${summary.runCount} simulated-throttling runs)` ,
    "",
    "| Metric | Median |",
    "| --- | ---: |",
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
  ];
  if (violations.length > 0) {
    lines.push("", "### Budget violations", "", ...violations.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

function runCli(filePaths) {
  const runs = filePaths.map((filePath) =>
    JSON.parse(readFileSync(filePath, "utf8")),
  );
  const summary = summarizeLighthouseRuns(runs);
  const violations = evaluateLighthouseBudgets(summary);
  const markdown = renderMarkdownSummary(summary, violations);

  console.log(markdown);
  writeFileSync(
    process.env.LIGHTHOUSE_SUMMARY_PATH || "lighthouse-results/summary.json",
    `${JSON.stringify({ summary, violations }, null, 2)}\n`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2));
}

module.exports = {
  DEFAULT_BUDGETS,
  evaluateLighthouseBudgets,
  renderMarkdownSummary,
  summarizeLighthouseRuns,
};
