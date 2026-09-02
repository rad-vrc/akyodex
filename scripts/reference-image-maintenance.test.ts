import assert from "node:assert/strict";
import test from "node:test";

import {
  auditReferenceImages,
  createBackfillBatches,
  createHeadPool,
  selectReferenceSources,
  type HeadObjectResult,
  type ListedR2Object,
} from "./reference-image-maintenance";

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

  assert.deepEqual(selected, [
    { eTag: "etag-0800", key: "0800.png", size: 4_000_000 },
    { eTag: "etag-0801", key: "0801.png", size: 2_000_000 },
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

  const report = await auditReferenceImages(selectReferenceSources(SOURCES), async (key) =>
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
    eTag: `etag-${index}`,
    key: `${String(index).padStart(4, "0")}.png`,
    size: 1_000,
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
