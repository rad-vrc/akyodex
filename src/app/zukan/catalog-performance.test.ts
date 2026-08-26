import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogLoadPerformance,
  getCatalogFailureReason,
} from "./catalog-performance";

class FakePerformanceClock {
  timeOrigin = 1_000;
  currentTime = 0;
  marks: string[] = [];

  now(): number {
    return this.currentTime;
  }

  mark(name: string): void {
    this.marks.push(name);
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
  });
  assert.equal(measurement.markReady(), null);
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
