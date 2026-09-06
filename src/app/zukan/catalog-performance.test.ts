import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogLoadPerformance,
  describeCatalogFailureCause,
  getCatalogFailureReason,
} from "./catalog-performance";

class FakePerformanceClock {
  timeOrigin = 1_000;
  currentTime = 0;
  marks: string[] = [];
  measures: Array<{ name: string; startMark: string; endMark: string }> = [];

  now(): number {
    return this.currentTime;
  }

  mark(name: string): void {
    this.marks.push(name);
  }

  measure(name: string, startMark: string, endMark: string): void {
    this.measures.push({ name, startMark, endMark });
  }
}

test("CatalogLoadPerformance records fetch, response, and ready timing", () => {
  const clock = new FakePerformanceClock();
  const measurement = new CatalogLoadPerformance("ja", clock);

  clock.currentTime = 40;
  measurement.markResponse("api");
  clock.currentTime = 125;
  const event = measurement.markReady();

  assert.deepEqual(clock.marks, [
    "catalog-fetch-start",
    "catalog-response",
    "catalog-ready",
  ]);
  assert.deepEqual(event, {
    language: "ja",
    source: "api",
    durationMs: 125,
    failureReason: null,
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 1_125,
    phaseDurationsMs: {
      normalize: 0,
      searchIndex: 0,
      stateApply: 0,
    },
  });
  assert.equal(measurement.markReady(), null);
});

test("CatalogLoadPerformance measures normalization, search indexing, and state application separately", () => {
  const clock = new FakePerformanceClock();
  const measurement = new CatalogLoadPerformance("ja", clock);

  measurement.startPhase("normalize");
  clock.currentTime = 12;
  measurement.endPhase("normalize");
  measurement.startPhase("search-index");
  clock.currentTime = 31;
  measurement.endPhase("search-index");
  measurement.startPhase("state-apply");
  clock.currentTime = 70;
  measurement.endPhase("state-apply");
  const event = measurement.markReady();

  assert.deepEqual(event?.phaseDurationsMs, {
    normalize: 12,
    searchIndex: 19,
    stateApply: 39,
  });
  assert.deepEqual(clock.measures, [
    {
      name: "catalog-normalize",
      startMark: "catalog-normalize-start",
      endMark: "catalog-normalize-end",
    },
    {
      name: "catalog-search-index",
      startMark: "catalog-search-index-start",
      endMark: "catalog-search-index-end",
    },
    {
      name: "catalog-state-apply",
      startMark: "catalog-state-apply-start",
      endMark: "catalog-state-apply-end",
    },
  ]);
});

test("CatalogLoadPerformance records a sanitized failure without a ready mark", () => {
  const clock = new FakePerformanceClock();
  const measurement = new CatalogLoadPerformance("en", clock);

  clock.currentTime = 75;
  const event = measurement.markFailure(
    new Error("request URL and response details must not be reported"),
  );

  assert.deepEqual(clock.marks, ["catalog-fetch-start"]);
  assert.equal(event?.language, "en");
  assert.equal(event?.source, "none");
  assert.equal(event?.durationMs, 75);
  assert.equal(event?.failureReason, "Error");
});

test("getCatalogFailureReason keeps only the error class", () => {
  assert.equal(
    getCatalogFailureReason(new DOMException("cancelled", "AbortError")),
    "AbortError",
  );
  assert.equal(getCatalogFailureReason("private response body"), "UnknownError");
});

test("describeCatalogFailureCause は取得元ごとの失敗を 1 行にまとめる", () => {
  // 「全部失敗した」だけでは api / r2 / snapshot のどれがどう落ちたか分からない
  const error = new Error("All complete catalog sources failed", {
    cause: new AggregateError([
      new Error("Catalog request failed with HTTP 503"),
      new TypeError("Failed to fetch"),
      new Error("Catalog payload must contain a non-empty data array"),
    ]),
  });

  assert.equal(
    describeCatalogFailureCause(error),
    "Error: Catalog request failed with HTTP 503 | " +
      "TypeError: Failed to fetch | " +
      "Error: Catalog payload must contain a non-empty data array",
  );
});

test("describeCatalogFailureCause は URL を落とす", () => {
  const error = new Error("All complete catalog sources failed", {
    cause: new AggregateError([
      new TypeError("Failed to fetch https://images.akyodex.com/data/x.json"),
    ]),
  });

  assert.equal(
    describeCatalogFailureCause(error),
    "TypeError: Failed to fetch [url]",
  );
});

test("describeCatalogFailureCause は Error 以外の cause を要約しない", () => {
  assert.equal(describeCatalogFailureCause(new Error("boom")), undefined);
  assert.equal(
    describeCatalogFailureCause(
      new Error("wrapped", { cause: new Error("inner") }),
    ),
    undefined,
  );
  assert.equal(describeCatalogFailureCause("not an error"), undefined);
});
