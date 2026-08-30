import assert from "node:assert/strict";
import test from "node:test";

import {
  handleReferenceImageBatch,
  parseReferenceImageEvent,
  transformReferenceImage,
  type GeneratorQueueMessage,
  type ImagesBindingLike,
} from "./index";
import {
  PermanentReferenceImageError,
  ReferenceImageGenerationError,
  type ReferenceImageEvent,
  type ReferenceProcessResult,
  type ReferenceTransformRequest,
} from "./generator";

class FakeMessage implements GeneratorQueueMessage {
  readonly body: unknown;
  ackCount = 0;
  retryOptions: Array<{ delaySeconds: number }> = [];

  constructor(body: unknown) {
    this.body = body;
  }

  ack(): void {
    this.ackCount += 1;
  }

  retry(options: { delaySeconds: number }): void {
    this.retryOptions.push(options);
  }
}

const EVENT: ReferenceImageEvent = {
  action: "PutObject",
  object: { key: "0800.png", eTag: "source-v1", size: 123 },
};

test("parses R2 notifications and rejects malformed queue bodies", () => {
  assert.deepEqual(
    parseReferenceImageEvent({
      account: "account",
      action: "PutObject",
      bucket: "akyo-images",
      eventTime: "2026-08-31T00:00:00.000Z",
      object: { key: "0800.png", eTag: "source-v1", size: 123 },
    }),
    EVENT,
  );
  assert.equal(parseReferenceImageEvent({ action: "Unknown", object: {} }), null);
  assert.equal(parseReferenceImageEvent("not an event"), null);
});

test("acknowledges successful and permanent messages but retries transient failures", async () => {
  const successful = new FakeMessage(EVENT);
  const permanent = new FakeMessage({ ...EVENT, object: { ...EVENT.object, key: "0801.png" } });
  const transient = new FakeMessage({ ...EVENT, object: { ...EVENT.object, key: "0802.png" } });
  const captured: Array<{ error: Error; key: string; stage: string }> = [];
  const logs: Array<Record<string, unknown>> = [];

  await handleReferenceImageBatch([successful, permanent, transient], {
    async process(event): Promise<ReferenceProcessResult> {
      if (event.object.key === "0801.png") {
        throw new PermanentReferenceImageError("too large", {
          key: event.object.key,
          stage: "source-size",
        });
      }
      if (event.object.key === "0802.png") {
        throw new ReferenceImageGenerationError("R2 unavailable", {
          key: event.object.key,
          stage: "source-head",
        });
      }
      return { key: event.object.key, status: "generated", written: ["preview", "zoom"] };
    },
    captureException(error, context) {
      captured.push({ error, ...context });
    },
    log(entry) {
      logs.push(entry);
    },
    now: (() => {
      let now = 100;
      return () => (now += 5);
    })(),
  });

  assert.equal(successful.ackCount, 1);
  assert.deepEqual(successful.retryOptions, []);
  assert.equal(permanent.ackCount, 1);
  assert.deepEqual(permanent.retryOptions, []);
  assert.equal(transient.ackCount, 0);
  assert.deepEqual(transient.retryOptions, [{ delaySeconds: 60 }]);
  assert.deepEqual(
    captured.map(({ key, stage }) => ({ key, stage })),
    [
      { key: "0801.png", stage: "source-size" },
      { key: "0802.png", stage: "source-head" },
    ],
  );
  assert.equal(logs.every((entry) => !("url" in entry) && !("user" in entry)), true);
});

test("acknowledges malformed messages without invoking the generator", async () => {
  const malformed = new FakeMessage({ action: "PutObject", object: { key: 800 } });
  let processCalls = 0;

  await handleReferenceImageBatch([malformed], {
    async process() {
      processCalls += 1;
      return { key: "", status: "ignored", written: [] };
    },
    log() {},
  });

  assert.equal(malformed.ackCount, 1);
  assert.equal(processCalls, 0);
});

test("uses the Images binding with fixed transformation and returns WebP bytes", async () => {
  const calls: Array<{ transform?: unknown; output?: unknown }> = [];
  const binding: ImagesBindingLike = {
    input() {
      const call: { transform?: unknown; output?: unknown } = {};
      calls.push(call);
      return {
        transform(options) {
          call.transform = options;
          return this;
        },
        output(options) {
          call.output = options;
          return {
            async response() {
              return new Response(new Uint8Array([8, 2]), {
                headers: { "Content-Type": "image/webp" },
                status: 200,
              });
            },
          };
        },
      };
    },
  };
  const request: ReferenceTransformRequest = {
    source: new Blob([new Uint8Array([1]).buffer]).stream(),
    width: 960,
    fit: "scale-down",
    format: "image/webp",
    quality: 82,
  };

  const result = await transformReferenceImage(binding, request);

  assert.deepEqual(calls, [
    {
      transform: { fit: "scale-down", width: 960 },
      output: { format: "image/webp", quality: 82 },
    },
  ]);
  assert.deepEqual([...new Uint8Array(result.bytes)], [8, 2]);
  assert.equal(result.contentType, "image/webp");
});

test("rejects unsuccessful or non-WebP Images responses", async () => {
  const createBinding = (response: Response): ImagesBindingLike => ({
    input() {
      return {
        transform() {
          return this;
        },
        output() {
          return { response: async () => response };
        },
      };
    },
  });
  const request: ReferenceTransformRequest = {
    source: new Blob([new Uint8Array([1]).buffer]).stream(),
    width: 960,
    fit: "scale-down",
    format: "image/webp",
    quality: 82,
  };

  await assert.rejects(
    transformReferenceImage(createBinding(new Response("failed", { status: 502 })), request),
    ReferenceImageGenerationError,
  );
  await assert.rejects(
    transformReferenceImage(
      createBinding(
        new Response("not webp", {
          headers: { "Content-Type": "text/plain" },
          status: 200,
        }),
      ),
      request,
    ),
    ReferenceImageGenerationError,
  );
});
