import {
  getReferenceDerivativeKey,
  REFERENCE_DERIVATIVE_KEY_PATTERN,
  REFERENCE_GENERATOR_VERSION,
  REFERENCE_IMAGE_CACHE_CONTROL,
  REFERENCE_QUALITY,
  REFERENCE_SOURCE_KEY_PATTERN,
  REFERENCE_VARIANTS,
} from "../src/lib/reference-image-contract";

const MAX_QUEUE_BATCH_SIZE = 100;

export interface ListedR2Object {
  ETag?: string;
  Key?: string;
  Size?: number;
}

export interface ReferenceSource {
  eTag: string;
  key: string;
  size: number;
}

export interface QueueBackfillBatch {
  messages: Array<{
    body: {
      action: "Backfill";
      object: { eTag: string; key: string; size: number };
    };
    content_type: "json";
  }>;
}

export interface HeadObjectResult {
  CacheControl?: string;
  ContentLength?: number;
  ContentType?: string;
  Metadata?: Record<string, string>;
}

export interface ReferenceAuditIssue {
  key: string;
  reasons: string[];
}

export interface ReferenceAuditReport {
  issues: ReferenceAuditIssue[];
  sourceCount: number;
  validDerivativeCount: number;
  incompleteSourceCount: number;
  orphanCount: number;
}

export interface ReferenceSourceSelection {
  sources: ReferenceSource[];
  incomplete: ReferenceAuditIssue[];
}

export function createHeadPool(
  headObject: (key: string) => Promise<HeadObjectResult | null>,
  concurrency: number,
): (key: string) => Promise<HeadObjectResult | null> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("HEAD concurrency must be a positive integer");
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    // Transfer the occupied permit without exposing a free slot to new callers.
    if (next) next();
    else active -= 1;
  }

  return async (key) => {
    await acquire();
    try {
      return await headObject(key);
    } finally {
      release();
    }
  };
}

function normalizeEtag(eTag: string): string {
  return eTag.trim().replace(/^"|"$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCompleteR2Listing(value: unknown): ListedR2Object[] {
  if (!isRecord(value)) throw new Error("Invalid R2 listing response");
  if (value.IsTruncated === true) throw new Error("R2 listing is incomplete (IsTruncated)");
  if (value.IsTruncated !== undefined && typeof value.IsTruncated !== "boolean") {
    throw new Error("Invalid R2 listing IsTruncated value");
  }
  for (const name of ["NextContinuationToken", "NextToken"]) {
    const token = value[name];
    if (token !== undefined && token !== null && token !== "") {
      throw new Error(`R2 listing is incomplete (${name})`);
    }
  }
  if (value.Contents === undefined) return [];
  if (!Array.isArray(value.Contents)) throw new Error("Invalid R2 listing Contents");
  const keys = new Set<string>();
  return value.Contents.map((object: unknown) => {
    if (!isRecord(object) || typeof object.Key !== "string" || !object.Key) {
      throw new Error("Invalid R2 listing object key");
    }
    if (keys.has(object.Key)) throw new Error(`Duplicate R2 listing key: ${object.Key}`);
    keys.add(object.Key);
    return {
      Key: object.Key,
      ...(typeof object.ETag === "string" ? { ETag: object.ETag } : {}),
      ...(typeof object.Size === "number" ? { Size: object.Size } : {}),
    };
  });
}

export function selectReferenceSources(objects: ListedR2Object[]): ReferenceSourceSelection {
  const sources: ReferenceSource[] = [];
  const incomplete: ReferenceAuditIssue[] = [];
  for (const object of objects) {
    if (typeof object.Key !== "string" || !REFERENCE_SOURCE_KEY_PATTERN.test(object.Key)) continue;
    const eTag = typeof object.ETag === "string" ? normalizeEtag(object.ETag) : "";
    const reasons: string[] = [];
    if (!eTag) reasons.push("source-metadata-etag");
    if (typeof object.Size !== "number" || !Number.isSafeInteger(object.Size) || object.Size < 0) {
      reasons.push("source-metadata-size");
    }
    if (reasons.length > 0) {
      incomplete.push({ key: object.Key, reasons });
    } else if (typeof object.Size === "number") {
      sources.push({ eTag, key: object.Key, size: object.Size });
    }
  }
  sources.sort((left, right) => left.key.localeCompare(right.key));
  incomplete.sort((left, right) => left.key.localeCompare(right.key));
  return { sources, incomplete };
}

export function requireReferenceSources(objects: ListedR2Object[]): ReferenceSource[] {
  const { sources, incomplete } = selectReferenceSources(objects);
  if (incomplete.length > 0) {
    throw new Error(`Incomplete reference originals: ${incomplete.map(({ key, reasons }) => `${key}: ${reasons.join(", ")}`).join("; ")}`);
  }
  if (sources.length === 0) throw new Error("No root-level four-digit PNGs found");
  return sources;
}

function findDerivativeInventoryIssues(
  objects: ListedR2Object[],
  selection: ReferenceSourceSelection,
): ReferenceAuditIssue[] {
  const sourceKeys = new Set([...selection.sources, ...selection.incomplete].map(({ key }) => key));
  const issues: ReferenceAuditIssue[] = [];
  for (const { Key: key } of objects) {
    if (!key?.startsWith("reference/")) continue;
    const match = REFERENCE_DERIVATIVE_KEY_PATTERN.exec(key);
    if (!match) issues.push({ key, reasons: ["unexpected-key"] });
    else if (!sourceKeys.has(`${match[1]}.png`)) issues.push({ key, reasons: ["orphan"] });
  }
  return issues.sort((left, right) => left.key.localeCompare(right.key));
}

export function createBackfillBatches(sources: ReferenceSource[]): QueueBackfillBatch[] {
  const messages: QueueBackfillBatch["messages"] = sources.map((source) => ({
    body: {
      action: "Backfill",
      object: {
        eTag: source.eTag,
        key: source.key,
        size: source.size,
      },
    },
    content_type: "json",
  }));
  const batches: QueueBackfillBatch[] = [];
  for (let index = 0; index < messages.length; index += MAX_QUEUE_BATCH_SIZE) {
    batches.push({ messages: messages.slice(index, index + MAX_QUEUE_BATCH_SIZE) });
  }
  return batches;
}

function auditDerivative(
  source: ReferenceSource,
  width: number,
  maxBytes: number,
  object: HeadObjectResult | null,
): string[] {
  if (!object) {
    return ["missing"];
  }

  const reasons: string[] = [];
  if (object.ContentType !== "image/webp") reasons.push("content-type");
  if (object.CacheControl !== REFERENCE_IMAGE_CACHE_CONTROL) reasons.push("cache-control");
  if (object.Metadata?.["source-etag"] !== source.eTag) reasons.push("source-etag");
  if (object.Metadata?.["generator-version"] !== REFERENCE_GENERATOR_VERSION) {
    reasons.push("generator-version");
  }
  if (object.Metadata?.width !== String(width)) reasons.push("width");
  if (object.Metadata?.quality !== String(REFERENCE_QUALITY)) reasons.push("quality");
  if (typeof object.ContentLength !== "number" || !Number.isSafeInteger(object.ContentLength) || object.ContentLength <= 0 || object.ContentLength > maxBytes) {
    reasons.push("size");
  }
  return reasons;
}

export async function auditReferenceImages(
  objects: ListedR2Object[],
  headObject: (key: string) => Promise<HeadObjectResult | null>,
): Promise<ReferenceAuditReport> {
  const selection = selectReferenceSources(objects);
  const { sources, incomplete } = selection;
  const inventoryIssues = findDerivativeInventoryIssues(objects, selection);
  const tasks = sources.flatMap((source) =>
    REFERENCE_VARIANTS.map((variant) => ({
      key: getReferenceDerivativeKey(source.key.slice(0, 4), variant.width),
      maxBytes: variant.maxBytes,
      source,
      width: variant.width,
    })),
  );

  const results = await Promise.all(
    tasks.map(async (task) => {
      const object = await headObject(task.key);
      const reasons = auditDerivative(
        task.source,
        task.width,
        task.maxBytes,
        object,
      );
      return { key: task.key, reasons };
    }),
  );

  const issues: ReferenceAuditIssue[] = [...incomplete, ...inventoryIssues];
  const sourceCount = sources.length + incomplete.length;
  if (sourceCount === 0) issues.push({ key: "(inventory)", reasons: ["no-sources"] });
  let validDerivativeCount = 0;

  for (const result of results) {
    if (result.reasons.length === 0) {
      validDerivativeCount += 1;
    } else {
      issues.push({ key: result.key, reasons: result.reasons });
    }
  }

  return {
    issues,
    sourceCount,
    validDerivativeCount,
    incompleteSourceCount: incomplete.length,
    orphanCount: inventoryIssues.filter(({ reasons }) => reasons.includes("orphan")).length,
  };
}
