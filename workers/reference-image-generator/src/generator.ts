import {
  getReferenceDerivativeKey,
  REFERENCE_GENERATOR_VERSION,
  REFERENCE_IMAGE_CACHE_CONTROL,
  REFERENCE_QUALITY,
  REFERENCE_SOURCE_KEY_PATTERN,
  REFERENCE_VARIANTS,
  type ReferenceImageWidth,
} from "../../../src/lib/reference-image-contract";

export { REFERENCE_GENERATOR_VERSION, REFERENCE_IMAGE_CACHE_CONTROL, REFERENCE_VARIANTS };
export const MAX_SOURCE_IMAGE_BYTES = 20_000_000;

export interface ReferenceImageKeys {
  sourceKey: string;
  previewKey: string;
  zoomKey: string;
}

export interface ReferenceObject {
  key: string;
  etag: string;
  size: number;
  customMetadata?: Record<string, string>;
}

export interface ReferenceObjectBody extends ReferenceObject {
  body: ReadableStream<Uint8Array>;
}

export interface ReferenceBucket {
  head(key: string): Promise<ReferenceObject | null>;
  get(
    key: string,
    options?: { onlyIf?: { etagMatches: string } },
  ): Promise<ReferenceObjectBody | ReferenceObject | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: {
        cacheControl: string;
        contentType: string;
      };
    },
  ): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export interface ReferenceTransformRequest {
  source: ReadableStream<Uint8Array>;
  width: number;
  fit: "scale-down";
  format: "image/webp";
  quality: typeof REFERENCE_QUALITY;
}

export interface ReferenceTransformResult {
  bytes: ArrayBuffer;
  contentType: string;
}

export type ReferenceTransform = (
  request: ReferenceTransformRequest,
) => Promise<ReferenceTransformResult>;

export interface ReferenceImageEvent {
  action:
    | "PutObject"
    | "CopyObject"
    | "CompleteMultipartUpload"
    | "DeleteObject"
    | "LifecycleDeletion"
    | "Backfill";
  object: {
    key: string;
    eTag?: string;
    size?: number;
  };
}

export type ReferenceProcessStatus =
  | "current"
  | "deleted"
  | "generated"
  | "ignored"
  | "missing"
  | "stale";

export interface ReferenceProcessResult {
  key: string;
  status: ReferenceProcessStatus;
  written: string[];
}

export class PermanentReferenceImageError extends Error {
  readonly key: string;
  readonly stage: string;

  constructor(message: string, { key, stage }: { key: string; stage: string }) {
    super(message);
    this.name = "PermanentReferenceImageError";
    this.key = key;
    this.stage = stage;
  }
}

export class ReferenceImageGenerationError extends Error {
  readonly key: string;
  readonly stage: string;

  constructor(message: string, { key, stage }: { key: string; stage: string }) {
    super(message);
    this.name = "ReferenceImageGenerationError";
    this.key = key;
    this.stage = stage;
  }
}

export function getReferenceImageKeys(sourceKey: string): ReferenceImageKeys | null {
  const match = REFERENCE_SOURCE_KEY_PATTERN.exec(sourceKey);
  if (!match) {
    return null;
  }

  const id = match[1];
  return {
    sourceKey,
    previewKey: getReferenceDerivativeKey(id, REFERENCE_VARIANTS[0].width),
    zoomKey: getReferenceDerivativeKey(id, REFERENCE_VARIANTS[1].width),
  };
}

function isDeleteAction(action: ReferenceImageEvent["action"]): boolean {
  return action === "DeleteObject" || action === "LifecycleDeletion";
}

function getVariantKey(keys: ReferenceImageKeys, width: ReferenceImageWidth): string {
  return getReferenceDerivativeKey(keys.sourceKey.slice(0, 4), width);
}

function isCurrentDerivative(
  object: ReferenceObject | null,
  sourceEtag: string,
  width: number,
): boolean {
  return (
    object?.customMetadata?.["source-etag"] === sourceEtag &&
    object.customMetadata["generator-version"] === REFERENCE_GENERATOR_VERSION &&
    object.customMetadata.width === String(width) &&
    object.customMetadata.quality === String(REFERENCE_QUALITY)
  );
}

async function processDeleteEvent(
  keys: ReferenceImageKeys,
  bucket: ReferenceBucket,
): Promise<ReferenceProcessResult> {
  const currentSource = await bucket.head(keys.sourceKey);
  if (currentSource) {
    return { key: keys.sourceKey, status: "stale", written: [] };
  }

  const derivativeKeys = [keys.previewKey, keys.zoomKey];
  await bucket.delete(derivativeKeys);
  return { key: keys.sourceKey, status: "deleted", written: [] };
}

/**
 * Requires max_batch_size=1 and max_concurrency=1 (enforced by config tests).
 * Source HEAD/GET checks and derivative writes are not an atomic cross-key operation.
 * Parallel consumers require per-key serialization or another proven concurrency design.
 */
export async function processReferenceImageEvent(
  event: ReferenceImageEvent,
  {
    bucket,
    transform,
  }: {
    bucket: ReferenceBucket;
    transform: ReferenceTransform;
  },
): Promise<ReferenceProcessResult> {
  const keys = getReferenceImageKeys(event.object.key);
  if (!keys) {
    return { key: event.object.key, status: "ignored", written: [] };
  }

  if (isDeleteAction(event.action)) {
    return processDeleteEvent(keys, bucket);
  }

  const currentSource = await bucket.head(keys.sourceKey);
  if (!currentSource) {
    return { key: keys.sourceKey, status: "missing", written: [] };
  }

  if (event.object.eTag && event.object.eTag !== currentSource.etag) {
    return { key: keys.sourceKey, status: "stale", written: [] };
  }

  if (currentSource.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new PermanentReferenceImageError(
      `Reference image exceeds the ${MAX_SOURCE_IMAGE_BYTES}-byte Images binding limit`,
      { key: keys.sourceKey, stage: "source-size" },
    );
  }

  const derivativeObjects = await Promise.all(
    REFERENCE_VARIANTS.map(({ width }) => bucket.head(getVariantKey(keys, width))),
  );
  const pendingVariants = REFERENCE_VARIANTS.filter(
    ({ width }, index) =>
      !isCurrentDerivative(derivativeObjects[index], currentSource.etag, width),
  );
  if (pendingVariants.length === 0) {
    return { key: keys.sourceKey, status: "current", written: [] };
  }

  const transformed: Array<{
    bytes: ArrayBuffer;
    contentType: string;
    key: string;
    width: ReferenceImageWidth;
  }> = [];

  for (const variant of pendingVariants) {
    const source = await bucket.get(keys.sourceKey, {
      onlyIf: { etagMatches: currentSource.etag },
    });
    if (!source || !("body" in source)) {
      return { key: keys.sourceKey, status: "stale", written: [] };
    }

    let output: ReferenceTransformResult;
    try {
      output = await transform({
        source: source.body,
        width: variant.width,
        fit: "scale-down",
        format: "image/webp",
        quality: REFERENCE_QUALITY,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown Images binding failure";
      throw new ReferenceImageGenerationError(message, {
        key: keys.sourceKey,
        stage: `transform-${variant.width}`,
      });
    }
    if (output.contentType.toLowerCase() !== "image/webp") {
      throw new ReferenceImageGenerationError(
        `Images binding returned ${output.contentType || "an unknown content type"}`,
        { key: keys.sourceKey, stage: `transform-${variant.width}` },
      );
    }

    transformed.push({
      ...output,
      key: getVariantKey(keys, variant.width),
      width: variant.width,
    });
  }

  const sourceAfterTransform = await bucket.head(keys.sourceKey);
  if (!sourceAfterTransform || sourceAfterTransform.etag !== currentSource.etag) {
    return { key: keys.sourceKey, status: "stale", written: [] };
  }

  const written: string[] = [];
  for (const output of transformed) {
    await bucket.put(output.key, output.bytes, {
      customMetadata: {
        "generator-version": REFERENCE_GENERATOR_VERSION,
        quality: String(REFERENCE_QUALITY),
        "source-etag": currentSource.etag,
        width: String(output.width),
      },
      httpMetadata: {
        cacheControl: REFERENCE_IMAGE_CACHE_CONTROL,
        contentType: "image/webp",
      },
    });
    written.push(output.key);
  }

  return { key: keys.sourceKey, status: "generated", written };
}
