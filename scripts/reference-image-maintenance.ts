const REFERENCE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const REFERENCE_GENERATOR_VERSION = "v1";
const REFERENCE_QUALITY = "82";
const MAX_QUEUE_BATCH_SIZE = 100;

const VARIANTS = [
  { maxBytes: 250_000, width: 960 },
  { maxBytes: 350_000, width: 1920 },
] as const;

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
}

function normalizeEtag(eTag: string): string {
  return eTag.replace(/^"|"$/g, "");
}

export function selectReferenceSources(objects: ListedR2Object[]): ReferenceSource[] {
  return objects
    .flatMap((object): ReferenceSource[] => {
      if (
        typeof object.Key !== "string" ||
        !/^\d{4}\.png$/.test(object.Key) ||
        typeof object.ETag !== "string" ||
        typeof object.Size !== "number"
      ) {
        return [];
      }
      return [
        {
          eTag: normalizeEtag(object.ETag),
          key: object.Key,
          size: object.Size,
        },
      ];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
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

function getDerivativeKey(sourceKey: string, width: number): string {
  return `reference/${sourceKey.slice(0, 4)}-${width}.webp`;
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
  if (object.CacheControl !== REFERENCE_CACHE_CONTROL) reasons.push("cache-control");
  if (object.Metadata?.["source-etag"] !== source.eTag) reasons.push("source-etag");
  if (object.Metadata?.["generator-version"] !== REFERENCE_GENERATOR_VERSION) {
    reasons.push("generator-version");
  }
  if (object.Metadata?.width !== String(width)) reasons.push("width");
  if (object.Metadata?.quality !== REFERENCE_QUALITY) reasons.push("quality");
  if (typeof object.ContentLength !== "number" || object.ContentLength > maxBytes) {
    reasons.push("size");
  }
  return reasons;
}

export async function auditReferenceImages(
  sources: ReferenceSource[],
  headObject: (key: string) => Promise<HeadObjectResult | null>,
): Promise<ReferenceAuditReport> {
  const issues: ReferenceAuditIssue[] = [];
  let validDerivativeCount = 0;

  for (const source of sources) {
    for (const variant of VARIANTS) {
      const key = getDerivativeKey(source.key, variant.width);
      const reasons = auditDerivative(
        source,
        variant.width,
        variant.maxBytes,
        await headObject(key),
      );
      if (reasons.length === 0) {
        validDerivativeCount += 1;
      } else {
        issues.push({ key, reasons });
      }
    }
  }

  return {
    issues,
    sourceCount: sources.length,
    validDerivativeCount,
  };
}
