import * as Sentry from "@sentry/cloudflare";
import { REFERENCE_QUALITY } from "../../../src/lib/reference-image-contract";

import {
  PermanentReferenceImageError,
  ReferenceImageGenerationError,
  processReferenceImageEvent,
  type ReferenceBucket,
  type ReferenceImageEvent,
  type ReferenceObject,
  type ReferenceObjectBody,
  type ReferenceProcessResult,
  type ReferenceTransformRequest,
  type ReferenceTransformResult,
} from "./generator";

const RETRY_DELAY_SECONDS = 60;

const REFERENCE_ACTIONS = new Set<ReferenceImageEvent["action"]>([
  "Backfill",
  "CompleteMultipartUpload",
  "CopyObject",
  "DeleteObject",
  "LifecycleDeletion",
  "PutObject",
]);

export interface GeneratorQueueMessage {
  body: unknown;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

interface GeneratorQueueBatch {
  messages: readonly GeneratorQueueMessage[];
}

interface GeneratorExecutionContext {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
}

interface R2ObjectLike {
  customMetadata?: Record<string, string>;
  etag: string;
  key: string;
  size: number;
}

interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array>;
}

interface R2BucketLike {
  delete(keys: string[]): Promise<void>;
  get(
    key: string,
    options?: { onlyIf?: { etagMatches: string } },
  ): Promise<R2ObjectBodyLike | R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { cacheControl: string; contentType: string };
    },
  ): Promise<R2ObjectLike | null>;
}

interface ImagePipeline {
  transform(options: { fit: "scale-down"; width: number }): ImagePipeline;
  output(options: {
    format: "image/webp";
    quality: typeof REFERENCE_QUALITY;
  }):
    | Promise<{ response(): Response | Promise<Response> }>
    | { response(): Response | Promise<Response> };
}

export interface ImagesBindingLike {
  input(source: ReadableStream<Uint8Array>): ImagePipeline;
}

interface GeneratorEnv {
  AKYO_BUCKET: R2BucketLike;
  IMAGES: ImagesBindingLike;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

interface QueueWorkerHandler<Env> {
  queue(
    batch: GeneratorQueueBatch,
    env: Env,
    ctx: GeneratorExecutionContext,
  ): Promise<void>;
}

interface BatchDependencies {
  process(event: ReferenceImageEvent): Promise<ReferenceProcessResult>;
  captureException?(
    error: Error,
    context: { key: string; stage: string },
  ): void;
  log?(entry: Record<string, unknown>): void;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseReferenceImageEvent(body: unknown): ReferenceImageEvent | null {
  if (!isRecord(body) || !REFERENCE_ACTIONS.has(body.action as ReferenceImageEvent["action"])) {
    return null;
  }
  if (!isRecord(body.object) || typeof body.object.key !== "string") {
    return null;
  }
  if (body.object.eTag !== undefined && typeof body.object.eTag !== "string") {
    return null;
  }
  if (body.object.size !== undefined && typeof body.object.size !== "number") {
    return null;
  }

  return {
    action: body.action as ReferenceImageEvent["action"],
    object: {
      key: body.object.key,
      ...(typeof body.object.eTag === "string" ? { eTag: body.object.eTag } : {}),
      ...(typeof body.object.size === "number" ? { size: body.object.size } : {}),
    },
  };
}

function getErrorContext(error: Error, event: ReferenceImageEvent): {
  key: string;
  stage: string;
} {
  if (
    error instanceof PermanentReferenceImageError ||
    error instanceof ReferenceImageGenerationError
  ) {
    return { key: error.key, stage: error.stage };
  }
  return { key: event.object.key, stage: "unclassified" };
}

export async function handleReferenceImageBatch(
  messages: readonly GeneratorQueueMessage[],
  dependencies: BatchDependencies,
): Promise<void> {
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((entry) => console.log(JSON.stringify(entry)));

  for (const message of messages) {
    const event = parseReferenceImageEvent(message.body);
    if (!event) {
      log({ event: "reference-image-generator", result: "invalid-message" });
      message.ack();
      continue;
    }

    const startedAt = now();
    try {
      const result = await dependencies.process(event);
      log({
        elapsedMs: Math.max(0, now() - startedAt),
        event: "reference-image-generator",
        key: result.key,
        result: result.status,
        written: result.written,
      });
      message.ack();
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unknown generator failure");
      const context = getErrorContext(error, event);
      dependencies.captureException?.(error, context);
      log({
        elapsedMs: Math.max(0, now() - startedAt),
        error: error.message,
        event: "reference-image-generator",
        key: context.key,
        result:
          error instanceof PermanentReferenceImageError
            ? "permanent-failure"
            : "retry",
        stage: context.stage,
      });

      if (error instanceof PermanentReferenceImageError) {
        message.ack();
      } else {
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      }
    }
  }
}

export async function transformReferenceImage(
  images: ImagesBindingLike,
  request: ReferenceTransformRequest,
): Promise<ReferenceTransformResult> {
  const output = await images
    .input(request.source)
    .transform({ fit: request.fit, width: request.width })
    .output({ format: request.format, quality: request.quality });
  const response = await output.response();
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || contentType.toLowerCase() !== "image/webp") {
    response.body?.cancel().catch(() => undefined);
    throw new ReferenceImageGenerationError(
      `Images binding failed with status ${response.status} and content type ${contentType || "unknown"}`,
      { key: "unknown", stage: `transform-${request.width}` },
    );
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType,
  };
}

function toReferenceObject(object: R2ObjectLike): ReferenceObject {
  return {
    customMetadata: object.customMetadata,
    etag: object.etag,
    key: object.key,
    size: object.size,
  };
}

function createReferenceBucket(bucket: R2BucketLike): ReferenceBucket {
  return {
    async head(key) {
      const object = await bucket.head(key);
      return object ? toReferenceObject(object) : null;
    },
    async get(key, options) {
      const object = await bucket.get(key, options);
      if (!object) {
        return null;
      }
      if (!("body" in object)) {
        return toReferenceObject(object);
      }
      return {
        ...toReferenceObject(object),
        body: object.body,
      } satisfies ReferenceObjectBody;
    },
    async put(key, value, options) {
      const stored = await bucket.put(key, value, options);
      if (!stored) {
        throw new ReferenceImageGenerationError("R2 rejected the derivative write", {
          key,
          stage: "derivative-put",
        });
      }
    },
    async delete(keys) {
      await bucket.delete(keys);
    },
  };
}

const handler = {
  async queue(batch, env) {
    const bucket = createReferenceBucket(env.AKYO_BUCKET);
    await handleReferenceImageBatch(batch.messages, {
      process: (event) =>
        processReferenceImageEvent(event, {
          bucket,
          transform: (request) => transformReferenceImage(env.IMAGES, request),
        }),
      captureException(error, context) {
        Sentry.captureException(error, {
          tags: {
            reference_image_key: context.key,
            reference_image_stage: context.stage,
          },
        });
      },
    });
  },
} satisfies QueueWorkerHandler<GeneratorEnv>;

export default Sentry.withSentry<GeneratorEnv>(
  (env) =>
    env.SENTRY_DSN
      ? {
          dsn: env.SENTRY_DSN,
          environment: env.SENTRY_ENVIRONMENT ?? "reference-image-generator",
          sendDefaultPii: false,
          tracesSampleRate: 0.1,
        }
      : undefined,
  handler,
);
