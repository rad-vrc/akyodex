import assert from "node:assert/strict";
import test from "node:test";

import {
  auditReferenceImages,
  createBackfillBatches,
  createHeadPool,
  parseCompleteR2Listing,
  requireReferenceSources,
  selectReferenceSources,
  type HeadObjectResult,
  type ListedR2Object,
} from "./reference-image-maintenance";
import { REFERENCE_VARIANTS } from "../src/lib/reference-image-contract";

const SOURCES: ListedR2Object[] = [
  { ETag: '"etag-0800"', Key: "0800.png", Size: 4_000_000 },
  { ETag: '"etag-0801"', Key: "0801.png", Size: 2_000_000 },
];

test("selects only root four-digit PNGs and normalizes their ETags", () => {
  const selected = selectReferenceSources([
    ...SOURCES,
    { ETag: '"derived"', Key: "reference/0800-960.webp", Size: 50_000 },
    { ETag: '"nested"', Key: "incoming/0802.png", Size: 1_000_000 },
    { ETag: '"short"', Key: "800.png", Size: 1_000_000 },
    { ETag: undefined, Key: "0802.png", Size: 1_000_000 },
  ]);

  assert.deepEqual(selected.sources, [
    { eTag: "etag-0800", key: "0800.png", size: 4_000_000 },
    { eTag: "etag-0801", key: "0801.png", size: 2_000_000 },
  ]);
  assert.deepEqual(selected.incomplete, [
    { key: "0802.png", reasons: ["source-metadata-etag"] },
  ]);
});

test("creates Queue API batches of at most one hundred JSON messages", () => {
  const sources = Array.from({ length: 205 }, (_, index) => ({
    eTag: `etag-${index}`,
    key: `${String(index).padStart(4, "0")}.png`,
    size: index + 1,
  }));

  const batches = createBackfillBatches(sources);

  assert.deepEqual(batches.map(({ messages }) => messages.length), [100, 100, 5]);
  assert.deepEqual(batches[0]?.messages[0], {
    body: {
      action: "Backfill",
      object: { eTag: "etag-0", key: "0000.png", size: 1 },
    },
    content_type: "json",
  });
});

test("audits derivative metadata, content type, cache policy, and size", async () => {
  const objects = new Map<string, HeadObjectResult | null>([
    [
      "reference/0800-960.webp",
      {
        CacheControl: "public, max-age=0, must-revalidate",
        ContentLength: 80_000,
        ContentType: "image/webp",
        Metadata: {
          "generator-version": "v1",
          quality: "82",
          "source-etag": "etag-0800",
          width: "960",
        },
      },
    ],
    [
      "reference/0800-1920.webp",
      {
        CacheControl: "public, max-age=0, must-revalidate",
        ContentLength: 180_000,
        ContentType: "image/webp",
        Metadata: {
          "generator-version": "v1",
          quality: "82",
          "source-etag": "stale-etag",
          width: "1920",
        },
      },
    ],
    ["reference/0801-960.webp", null],
    [
      "reference/0801-1920.webp",
      {
        CacheControl: "public, max-age=31536000, immutable",
        ContentLength: 400_000,
        ContentType: "image/png",
        Metadata: {
          "generator-version": "old",
          quality: "70",
          "source-etag": "wrong-etag",
          width: "960",
        },
      },
    ],
  ]);

  const report = await auditReferenceImages(SOURCES, async (key) =>
    objects.get(key) ?? null,
  );

  assert.equal(report.sourceCount, 2);
  assert.equal(report.validDerivativeCount, 1);
  assert.deepEqual(
    report.issues.map(({ key, reasons }) => ({ key, reasons })),
    [
      {
        key: "reference/0800-1920.webp",
        reasons: ["source-etag"],
      },
      {
        key: "reference/0801-960.webp",
        reasons: ["missing"],
      },
      {
        key: "reference/0801-1920.webp",
        reasons: [
          "content-type",
          "cache-control",
          "source-etag",
          "generator-version",
          "width",
          "quality",
          "size",
        ],
      },
    ],
  );
});

test("audits derivatives concurrently and bounds active requests to pool concurrency", async () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({
    ETag: `etag-${index}`,
    Key: `${String(index).padStart(4, "0")}.png`,
    Size: 1_000,
  }));

  const CONCURRENCY_LIMIT = 12;
  let active = 0;
  let maxConcurrentHeads = 0;

  const pooledHead = createHeadPool(async (key) => {
    active += 1;
    try {
      maxConcurrentHeads = Math.max(maxConcurrentHeads, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const sourceIndex = Number.parseInt(key.replace(/^reference\/(\d{4})-\d+\.webp$/, "$1"), 10);
      return {
        CacheControl: "public, max-age=0, must-revalidate",
        ContentLength: 50_000,
        ContentType: "image/webp",
        Metadata: {
          "generator-version": "v1",
          quality: "82",
          "source-etag": `etag-${sourceIndex}`,
          width: key.includes("960") ? "960" : "1920",
        },
      };
    } finally {
      active -= 1;
    }
  }, CONCURRENCY_LIMIT);

  const report = await auditReferenceImages(sources, pooledHead);

  assert.equal(maxConcurrentHeads, CONCURRENCY_LIMIT);
  assert.equal(report.sourceCount, 20);
  assert.equal(report.validDerivativeCount, 40);
  assert.equal(report.issues.length, 0);
});

for (const limit of [1, 12]) {
  test(`hands a permit to a waiter before a new arrival (limit ${limit})`, { timeout: 5_000 }, async () => {
    const gates = new Map<string, () => void>();
    const started = new Map<string, () => void>();
    let active = 0;
    let maximum = 0;
    let completed = 0;

    function waitForStart(key: string): Promise<void> {
      if (gates.has(key)) return Promise.resolve();
      return new Promise((resolve) => started.set(key, resolve));
    }

    const pooled = createHeadPool((key) => {
      active += 1;
      maximum = Math.max(maximum, active);
      return new Promise((resolve) => {
        gates.set(key, () => {
          gates.delete(key);
          active -= 1;
          completed += 1;
          resolve(null);
        });
        started.get(key)?.();
        started.delete(key);
      });
    }, limit);

    const tasks = Array.from({ length: limit }, (_, index) => pooled(`initial-${index}`));
    tasks.push(pooled("waiting"));
    await waitForStart("initial-0");
    gates.get("initial-0")!();

    // Queue the arrival after the running operation resumes, but before its waiter resumes.
    await new Promise<void>((resolve) => queueMicrotask(() => {
      tasks.push(pooled("arrival"));
      resolve();
    }));
    await waitForStart("waiting");
    for (let index = 1; index < limit; index += 1) {
      await waitForStart(`initial-${index}`);
      gates.get(`initial-${index}`)!();
    }
    gates.get("waiting")!();
    await waitForStart("arrival");
    gates.get("arrival")!();
    await Promise.all(tasks);

    assert.equal(completed, limit + 2);
    assert.equal(active, 0);
    assert.equal(gates.size, 0);
    assert.equal(started.size, 0);

    const probe = pooled("probe");
    await waitForStart("probe");
    gates.get("probe")!();
    await probe;
    assert.equal(completed, limit + 3);
    assert.ok(maximum <= limit, `observed ${maximum} active HEADs with limit ${limit}`);
  });
}

test("returns pool permits after a rejected HEAD", { timeout: 5_000 }, async () => {
  const pooled = createHeadPool(async (key) => {
    if (key === "failed") throw new Error("HEAD failed");
    return null;
  }, 1);
  const results = await Promise.allSettled([pooled("failed"), pooled("waiting")]);
  assert.deepEqual(results.map(({ status }) => status), ["rejected", "fulfilled"]);
  assert.equal(await pooled("probe"), null);
});

test("rejects invalid pool limits instead of leaving HEADs waiting forever", () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createHeadPool(async () => null, limit), /positive integer/);
  }
});

test("accepts complete CLI listings and rejects every continuation marker", () => {
  assert.deepEqual(parseCompleteR2Listing({ Contents: SOURCES, IsTruncated: false }), SOURCES);
  assert.deepEqual(parseCompleteR2Listing({ Contents: SOURCES }), SOURCES);
  assert.deepEqual(parseCompleteR2Listing({}), []);
  for (const marker of [
    { IsTruncated: true },
    { NextContinuationToken: "more" },
    { NextToken: "cli-more" },
  ]) {
    assert.throws(() => parseCompleteR2Listing({ Contents: SOURCES, ...marker }), /incomplete/);
  }
  for (const value of [null, [], { Contents: {} }, { Contents: [null] }, { Contents: [{}] }]) {
    assert.throws(() => parseCompleteR2Listing(value), /Invalid R2 listing/);
  }
  assert.throws(() => parseCompleteR2Listing({ Contents: [SOURCES[0], SOURCES[0]] }), /Duplicate/);
});

test("backfill rejects incomplete source metadata and an empty source inventory", () => {
  assert.deepEqual(requireReferenceSources(SOURCES), selectReferenceSources(SOURCES).sources);
  for (const invalid of [
    { Key: "0802.png", Size: 1 },
    { Key: "0802.png", ETag: '""', Size: 1 },
    { Key: "0802.png", ETag: "e" },
    { Key: "0802.png", ETag: "e", Size: -1 },
    { Key: "0802.png", ETag: "e", Size: NaN },
  ]) {
    assert.throws(() => requireReferenceSources([...SOURCES, invalid]), /0802\.png/);
  }
  assert.throws(() => requireReferenceSources([]), /No root-level/);
});

test("audits orphan derivatives without misclassifying an incomplete original", async () => {
  const inventory: ListedR2Object[] = [
    { Key: "0800.png", Size: 1 },
    { Key: "reference/0800-960.webp", Size: 100 },
    { Key: "reference/9999-960.webp", Size: 100 },
    { Key: "reference/unexpected.webp", Size: 100 },
    { Key: "other/unrelated.webp", Size: 100 },
  ];
  const original = structuredClone(inventory);
  const report = await auditReferenceImages(inventory, async () => {
    assert.fail("Incomplete originals must not be audited as valid sources");
  });
  assert.equal(report.sourceCount, 1);
  assert.equal(report.incompleteSourceCount, 1);
  assert.equal(report.orphanCount, 1);
  assert.deepEqual(report.issues, [
    { key: "0800.png", reasons: ["source-metadata-etag"] },
    { key: "reference/9999-960.webp", reasons: ["orphan"] },
    { key: "reference/unexpected.webp", reasons: ["unexpected-key"] },
  ]);
  assert.deepEqual(inventory, original);
});

test("an empty inventory cannot pass the audit as zero of zero", async () => {
  const report = await auditReferenceImages([], async () => null);
  assert.ok(report.issues.some(({ reasons }) => reasons.includes("no-sources")));
});

test("reports audit issues in input order even when HEADs finish in reverse order", { timeout: 5_000 }, async () => {
  const gates: Array<() => void> = [];
  const audit = auditReferenceImages(SOURCES, () => new Promise((resolve) => {
    gates.push(() => resolve(null));
  }));
  assert.equal(gates.length, 4);
  for (const release of gates.reverse()) release();
  const report = await audit;
  assert.deepEqual(report.issues.map(({ key }) => key), [
    "reference/0800-960.webp", "reference/0800-1920.webp",
    "reference/0801-960.webp", "reference/0801-1920.webp",
  ]);
});

test("size budgets are enforced exactly at the boundary for each width", async () => {
  const budgets = Object.fromEntries(
    REFERENCE_VARIANTS.map(({ width, maxBytes }) => [width, maxBytes]),
  );
  assert.deepEqual(budgets, { 960: 250_000, 1920: 600_000 });

  const head = (size: number, width: number, etag: string): HeadObjectResult => ({
    CacheControl: "public, max-age=0, must-revalidate",
    ContentLength: size,
    ContentType: "image/webp",
    Metadata: {
      "generator-version": "v1",
      quality: "82",
      "source-etag": etag,
      width: String(width),
    },
  });
  const objects = new Map<string, HeadObjectResult | null>([
    ["reference/0800-960.webp", head(250_000, 960, "etag-0800")],
    ["reference/0800-1920.webp", head(600_000, 1920, "etag-0800")],
    ["reference/0801-960.webp", head(250_001, 960, "etag-0801")],
    ["reference/0801-1920.webp", head(600_001, 1920, "etag-0801")],
  ]);

  const report = await auditReferenceImages(SOURCES, async (key) =>
    objects.get(key) ?? null,
  );

  assert.equal(report.validDerivativeCount, 2, "exactly at the budget passes");
  assert.deepEqual(
    report.issues.map(({ key, reasons }) => ({ key, reasons })),
    [
      { key: "reference/0801-960.webp", reasons: ["size"] },
      { key: "reference/0801-1920.webp", reasons: ["size"] },
    ],
  );
});
