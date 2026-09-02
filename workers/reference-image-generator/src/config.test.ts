import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface GeneratorConfig {
  images?: { binding?: string };
  name?: string;
  preview_urls?: boolean;
  queues?: {
    consumers?: Array<{
      dead_letter_queue?: string;
      max_batch_size?: number;
      max_batch_timeout?: number;
      max_concurrency?: number;
      max_retries?: number;
      queue?: string;
    }>;
  };
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
  routes?: unknown[];
  vars?: { SENTRY_ENVIRONMENT?: string };
  workers_dev?: boolean;
}

async function readConfig(fileName: string): Promise<GeneratorConfig> {
  const configPath = path.join(
    process.cwd(),
    "workers",
    "reference-image-generator",
    fileName,
  );
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as GeneratorConfig;
}

test("staging generator is private and isolated from production resources", async () => {
  const config = await readConfig("wrangler.staging.jsonc");

  assert.equal(config.name, "akyodex-reference-image-generator-staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.images, { binding: "IMAGES" });
  assert.deepEqual(config.r2_buckets, [
    { binding: "AKYO_BUCKET", bucket_name: "akyodex-workers-staging-data" },
  ]);
  assert.deepEqual(config.queues?.consumers, [
    {
      queue: "akyodex-reference-images-staging",
      dead_letter_queue: "akyodex-reference-images-staging-dlq",
      max_batch_size: 1,
      max_batch_timeout: 1,
      max_concurrency: 1,
      max_retries: 5,
    },
  ]);
  assert.equal(config.vars?.SENTRY_ENVIRONMENT, "staging-reference-images");
});

test("production generator is private and isolated from staging resources", async () => {
  const config = await readConfig("wrangler.production.jsonc");

  assert.equal(config.name, "akyodex-reference-image-generator-production");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.images, { binding: "IMAGES" });
  assert.deepEqual(config.r2_buckets, [
    { binding: "AKYO_BUCKET", bucket_name: "akyo-images" },
  ]);
  assert.deepEqual(config.queues?.consumers, [
    {
      queue: "akyodex-reference-images-production",
      dead_letter_queue: "akyodex-reference-images-production-dlq",
      max_batch_size: 1,
      max_batch_timeout: 1,
      max_concurrency: 1,
      max_retries: 5,
    },
  ]);
  assert.equal(config.vars?.SENTRY_ENVIRONMENT, "production-reference-images");
});

test("generator infrastructure workflow is manual, isolated, and usage guarded", async () => {
  const workflowPath = path.join(
    process.cwd(),
    ".github",
    "workflows",
    "reference-image-generator.yml",
  );
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /akyodex-reference-images-staging/);
  assert.match(workflow, /akyodex-reference-images-staging-dlq/);
  assert.match(workflow, /akyodex-reference-images-production/);
  assert.match(workflow, /akyodex-reference-images-production-dlq/);
  assert.match(workflow, /wrangler\.staging\.jsonc/);
  assert.match(workflow, /wrangler\.production\.jsonc/);
  assert.match(workflow, /--event-type object-create --event-type object-delete/);
  assert.match(workflow, /--suffix "\.png"/);
  assert.match(workflow, /REFERENCE_BACKFILL_REQUIRE_USAGE_GUARD: "true"/);
  assert.match(workflow, /REFERENCE_IMAGES_CURRENT_TRANSFORMATIONS/);
  assert.match(workflow, /npm run backfill:reference-images/);
  assert.match(workflow, /npm run audit:reference-images/);
});
