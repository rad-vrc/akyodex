import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REFERENCE_VARIANTS } from "../src/lib/reference-image-contract";

import {
  createBackfillBatches,
  parseCompleteR2Listing,
  requireReferenceSources,
  type ListedR2Object,
} from "./reference-image-maintenance";

const execFileAsync = promisify(execFile);
const IMAGES_FREE_TRANSFORMATION_LIMIT = 5_000;

interface QueueListResponse {
  result?: Array<{ queue_id?: string; queue_name?: string }>;
  success?: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function listR2Objects(bucket: string, endpoint: string): Promise<ListedR2Object[]> {
  const { stdout } = await execFileAsync("aws", [
    "s3api",
    "list-objects-v2",
    "--bucket",
    bucket,
    "--endpoint-url",
    endpoint,
    "--output",
    "json",
  ], { maxBuffer: 20 * 1024 * 1024 });
  return parseCompleteR2Listing(JSON.parse(stdout) as unknown);
}

async function resolveQueueId(
  accountId: string,
  apiToken: string,
  queueName: string,
): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  const payload = (await response.json()) as QueueListResponse;
  const queue = payload.result?.find(({ queue_name: name }) => name === queueName);
  if (!response.ok || payload.success !== true || !queue?.queue_id) {
    throw new Error(`Unable to resolve Cloudflare Queue ${queueName}`);
  }
  return queue.queue_id;
}

function assertTransformationBudget(sourceCount: number): void {
  if (process.env.REFERENCE_BACKFILL_REQUIRE_USAGE_GUARD !== "true") {
    return;
  }
  const currentValue = requireEnv("REFERENCE_IMAGES_CURRENT_TRANSFORMATIONS");
  const current = Number.parseInt(currentValue, 10);
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error("REFERENCE_IMAGES_CURRENT_TRANSFORMATIONS must be a non-negative integer");
  }
  const planned = sourceCount * REFERENCE_VARIANTS.length;
  const projected = current + planned;
  if (projected > IMAGES_FREE_TRANSFORMATION_LIMIT) {
    throw new Error(
      `Backfill blocked: projected ${projected} transformations exceeds the free limit of ${IMAGES_FREE_TRANSFORMATION_LIMIT}`,
    );
  }
  console.log(`[reference-backfill] Images usage guard: ${current} + ${planned} = ${projected}`);
}

async function enqueueBatches(
  accountId: string,
  apiToken: string,
  queueId: string,
  batches: ReturnType<typeof createBackfillBatches>,
): Promise<void> {
  for (const [index, batch] of batches.entries()) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages/batch`,
      {
        body: JSON.stringify(batch),
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const payload = (await response.json()) as { success?: boolean };
    if (!response.ok || payload.success !== true) {
      throw new Error(`Queue batch ${index + 1}/${batches.length} failed with HTTP ${response.status}`);
    }
    console.log(`[reference-backfill] Enqueued batch ${index + 1}/${batches.length}`);
  }
}

async function main(): Promise<void> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
  const bucket = requireEnv("REFERENCE_R2_BUCKET");
  const endpoint = requireEnv("REFERENCE_R2_ENDPOINT");
  const queueName = requireEnv("REFERENCE_QUEUE_NAME");

  const sources = requireReferenceSources(await listR2Objects(bucket, endpoint));
  assertTransformationBudget(sources.length);

  const queueId = await resolveQueueId(accountId, apiToken, queueName);
  const batches = createBackfillBatches(sources);
  await enqueueBatches(accountId, apiToken, queueId, batches);
  console.log(`[reference-backfill] Enqueued ${sources.length} original PNGs in ${batches.length} batches`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown reference backfill failure");
  process.exitCode = 1;
});
