import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SOURCE_IMAGE_BYTES,
  PermanentReferenceImageError,
  ReferenceImageGenerationError,
  REFERENCE_VARIANTS,
  getReferenceImageKeys,
  processReferenceImageEvent,
  type ReferenceBucket,
  type ReferenceImageEvent,
  type ReferenceObject,
  type ReferenceObjectBody,
  type ReferenceTransformRequest,
  type ReferenceTransformResult,
} from "./generator";

interface StoredObject extends ReferenceObject {
  bytes: Uint8Array;
  httpMetadata?: {
    cacheControl?: string;
    contentType?: string;
  };
}

class FakeBucket implements ReferenceBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly putKeys: string[] = [];
  readonly deleteKeys: string[] = [];

  set(
    key: string,
    {
      bytes = new Uint8Array([1, 2, 3]),
      etag,
      customMetadata,
      httpMetadata,
    }: {
      bytes?: Uint8Array;
      etag: string;
      customMetadata?: Record<string, string>;
      httpMetadata?: StoredObject["httpMetadata"];
    },
  ): void {
    this.objects.set(key, {
      key,
      etag,
      size: bytes.byteLength,
      bytes,
      customMetadata,
      httpMetadata,
    });
  }

  async head(key: string): Promise<ReferenceObject | null> {
    return this.objects.get(key) ?? null;
  }

  async get(
    key: string,
    options?: { onlyIf?: { etagMatches: string } },
  ): Promise<ReferenceObjectBody | ReferenceObject | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag) {
      return object;
    }

    return {
      ...object,
      body: new Blob([
        object.bytes.buffer.slice(
          object.bytes.byteOffset,
          object.bytes.byteOffset + object.bytes.byteLength,
        ) as ArrayBuffer,
      ]).stream(),
    };
  }

  async put(
    key: string,
    value: ArrayBuffer,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { cacheControl: string; contentType: string };
    },
  ): Promise<void> {
    this.putKeys.push(key);
    this.set(key, {
      bytes: new Uint8Array(value),
      etag: `derived-${this.putKeys.length}`,
      customMetadata: options.customMetadata,
      httpMetadata: options.httpMetadata,
    });
  }

  async delete(keys: string[]): Promise<void> {
    this.deleteKeys.push(...keys);
    for (const key of keys) {
      this.objects.delete(key);
    }
  }
}

function createTransform(
  onTransform?: (request: ReferenceTransformRequest, callIndex: number) => void | Promise<void>,
): {
  calls: ReferenceTransformRequest[];
  transform: (request: ReferenceTransformRequest) => Promise<ReferenceTransformResult>;
} {
  const calls: ReferenceTransformRequest[] = [];
  return {
    calls,
    async transform(request) {
      calls.push(request);
      await onTransform?.(request, calls.length - 1);
      return {
        bytes: new Uint8Array([request.width % 256, 82]).buffer,
        contentType: "image/webp",
      };
    },
  };
}

function createEvent(
  action: ReferenceImageEvent["action"],
  key = "0800.png",
  eTag = "source-v1",
): ReferenceImageEvent {
  return {
    action,
    object: {
      key,
      eTag,
      size: 3,
    },
  };
}

test("accepts only root-level four-digit PNG reference sheets", () => {
  assert.deepEqual(getReferenceImageKeys("0800.png"), {
    sourceKey: "0800.png",
    previewKey: "reference/0800-960.webp",
    zoomKey: "reference/0800-1920.webp",
  });
  assert.equal(getReferenceImageKeys("800.png"), null);
  assert.equal(getReferenceImageKeys("reference/0800.png"), null);
  assert.equal(getReferenceImageKeys("0800.webp"), null);
});

test("creates both fixed WebP variants without mutating the original PNG", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v1" });
  const transformer = createTransform();

  const result = await processReferenceImageEvent(createEvent("PutObject"), {
    bucket,
    transform: transformer.transform,
  });

  assert.equal(result.status, "generated");
  assert.deepEqual(
    transformer.calls.map(({ width, quality, format, fit }) => ({ width, quality, format, fit })),
    REFERENCE_VARIANTS.map(({ width }) => ({
      width,
      quality: 82,
      format: "image/webp",
      fit: "scale-down",
    })),
  );
  assert.deepEqual(bucket.putKeys, [
    "reference/0800-960.webp",
    "reference/0800-1920.webp",
  ]);
  assert.deepEqual(bucket.deleteKeys, []);
  assert.equal(bucket.objects.get("0800.png")?.etag, "source-v1");

  for (const variant of REFERENCE_VARIANTS) {
    const object = bucket.objects.get(`reference/0800-${variant.width}.webp`);
    assert.equal(object?.customMetadata?.["source-etag"], "source-v1");
    assert.equal(object?.customMetadata?.width, String(variant.width));
    assert.equal(object?.customMetadata?.quality, "82");
    assert.equal(object?.customMetadata?.["generator-version"], "v1");
    assert.equal(object?.httpMetadata?.contentType, "image/webp");
    assert.equal(
      object?.httpMetadata?.cacheControl,
      "public, max-age=0, must-revalidate",
    );
  }
});

test("ignores stale and duplicate create events", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v2" });
  const transformer = createTransform();

  const stale = await processReferenceImageEvent(createEvent("PutObject"), {
    bucket,
    transform: transformer.transform,
  });
  assert.equal(stale.status, "stale");

  for (const variant of REFERENCE_VARIANTS) {
    bucket.set(`reference/0800-${variant.width}.webp`, {
      etag: `derived-${variant.width}`,
      customMetadata: {
        "source-etag": "source-v2",
        "generator-version": "v1",
        width: String(variant.width),
        quality: "82",
      },
    });
  }

  const duplicate = await processReferenceImageEvent(
    createEvent("PutObject", "0800.png", "source-v2"),
    {
      bucket,
      transform: transformer.transform,
    },
  );
  assert.equal(duplicate.status, "current");
  assert.equal(transformer.calls.length, 0);
  assert.deepEqual(bucket.putKeys, []);
});

test("repairs only the missing or stale derivative", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v1" });
  bucket.set("reference/0800-960.webp", {
    etag: "preview-current",
    customMetadata: {
      "source-etag": "source-v1",
      "generator-version": "v1",
      width: "960",
      quality: "82",
    },
  });
  bucket.set("reference/0800-1920.webp", {
    etag: "zoom-stale",
    customMetadata: {
      "source-etag": "source-v0",
      "generator-version": "v1",
      width: "1920",
      quality: "82",
    },
  });
  const transformer = createTransform();

  await processReferenceImageEvent(createEvent("PutObject"), {
    bucket,
    transform: transformer.transform,
  });

  assert.deepEqual(transformer.calls.map(({ width }) => width), [1920]);
  assert.deepEqual(bucket.putKeys, ["reference/0800-1920.webp"]);
});

test("does not save derivatives when the original changes during transformation", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v1" });
  const transformer = createTransform((_request, callIndex) => {
    if (callIndex === 1) {
      bucket.set("0800.png", { etag: "source-v2" });
    }
  });

  const result = await processReferenceImageEvent(createEvent("PutObject"), {
    bucket,
    transform: transformer.transform,
  });

  assert.equal(result.status, "stale");
  assert.deepEqual(bucket.putKeys, []);
  assert.equal(bucket.objects.get("0800.png")?.etag, "source-v2");
});

test("deletes only derivatives after an explicit original deletion", async () => {
  const bucket = new FakeBucket();
  bucket.set("reference/0800-960.webp", { etag: "preview" });
  bucket.set("reference/0800-1920.webp", { etag: "zoom" });
  const transformer = createTransform();

  const result = await processReferenceImageEvent(createEvent("DeleteObject"), {
    bucket,
    transform: transformer.transform,
  });

  assert.equal(result.status, "deleted");
  assert.deepEqual(bucket.deleteKeys, [
    "reference/0800-960.webp",
    "reference/0800-1920.webp",
  ]);
  assert.equal(bucket.deleteKeys.includes("0800.png"), false);
});

test("ignores an old delete event after the original was uploaded again", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v2" });
  const transformer = createTransform();

  const result = await processReferenceImageEvent(createEvent("DeleteObject"), {
    bucket,
    transform: transformer.transform,
  });

  assert.equal(result.status, "stale");
  assert.deepEqual(bucket.deleteKeys, []);
});

test("rejects source images above the Images binding input limit without writes", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", {
    bytes: new Uint8Array(1),
    etag: "source-v1",
  });
  const stored = bucket.objects.get("0800.png");
  assert.ok(stored);
  stored.size = MAX_SOURCE_IMAGE_BYTES + 1;
  const transformer = createTransform();

  await assert.rejects(
    processReferenceImageEvent(createEvent("PutObject"), {
      bucket,
      transform: transformer.transform,
    }),
    PermanentReferenceImageError,
  );
  assert.deepEqual(bucket.putKeys, []);
  assert.equal(bucket.objects.has("0800.png"), true);
});

test("attributes transformation failures to the original key and width", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v1" });

  await assert.rejects(
    processReferenceImageEvent(createEvent("PutObject"), {
      bucket,
      async transform() {
        throw new ReferenceImageGenerationError("Images unavailable", {
          key: "unknown",
          stage: "transform",
        });
      },
    }),
    (caught: unknown) => {
      assert.ok(caught instanceof ReferenceImageGenerationError);
      assert.equal(caught.key, "0800.png");
      assert.equal(caught.stage, "transform-960");
      return true;
    },
  );
});

test("demonstrates concurrent consumer race where late v1 write overwrites v2 derivative", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v1" });
  const transformer = createTransform();

  let v1PassedFinalHead = false;
  let v2Completed = false;

  const originalHead = bucket.head.bind(bucket);
  let headCallCount = 0;
  bucket.head = async (key: string) => {
    const res = await originalHead(key);
    if (key === "0800.png") {
      headCallCount += 1;
      // Each generation reads the source HEAD at startup and once before writing.
      if (headCallCount === 2) {
        v1PassedFinalHead = true;
      }
    }
    return res;
  };

  const originalPut = bucket.put.bind(bucket);
  let putCallCount = 0;
  bucket.put = async (
    key: string,
    value: ArrayBuffer,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { cacheControl: string; contentType: string };
    },
  ) => {
    putCallCount += 1;
    if (putCallCount === 1 && v1PassedFinalHead && !v2Completed) {
      v2Completed = true;
      bucket.set("0800.png", { etag: "source-v2" });
      await processReferenceImageEvent(createEvent("PutObject", "0800.png", "source-v2"), {
        bucket,
        transform: transformer.transform,
      });
      assert.equal(
        bucket.objects.get("reference/0800-960.webp")?.customMetadata?.["source-etag"],
        "source-v2",
      );
      assert.equal(
        bucket.objects.get("reference/0800-1920.webp")?.customMetadata?.["source-etag"],
        "source-v2",
      );
    }
    return originalPut(key, value, options);
  };

  await processReferenceImageEvent(createEvent("PutObject", "0800.png", "source-v1"), {
    bucket,
    transform: transformer.transform,
  });

  assert.equal(v1PassedFinalHead, true);
  assert.equal(v2Completed, true);

  // Under concurrent execution, late v1 write overwrites the derivatives back to source-v1
  assert.equal(
    bucket.objects.get("reference/0800-960.webp")?.customMetadata?.["source-etag"],
    "source-v1",
  );
  assert.equal(
    bucket.objects.get("reference/0800-1920.webp")?.customMetadata?.["source-etag"],
    "source-v1",
  );
});

test("serial execution rejects old v1 event after v2 has been processed", async () => {
  const bucket = new FakeBucket();
  bucket.set("0800.png", { etag: "source-v2" });
  for (const variant of REFERENCE_VARIANTS) {
    bucket.set(`reference/0800-${variant.width}.webp`, {
      etag: `derived-${variant.width}`,
      customMetadata: {
        "generator-version": "v1",
        quality: "82",
        "source-etag": "source-v2",
        width: String(variant.width),
      },
    });
  }
  const transformer = createTransform();

  const staleResult = await processReferenceImageEvent(
    createEvent("PutObject", "0800.png", "source-v1"),
    {
      bucket,
      transform: transformer.transform,
    },
  );

  assert.equal(staleResult.status, "stale");
  assert.equal(
    bucket.objects.get("reference/0800-960.webp")?.customMetadata?.["source-etag"],
    "source-v2",
  );
  assert.equal(
    bucket.objects.get("reference/0800-1920.webp")?.customMetadata?.["source-etag"],
    "source-v2",
  );
});
