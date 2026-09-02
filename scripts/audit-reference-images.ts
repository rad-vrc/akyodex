import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  auditReferenceImages,
  createHeadPool,
  selectReferenceSources,
  type HeadObjectResult,
  type ListedR2Object,
} from "./reference-image-maintenance";

const execFileAsync = promisify(execFile);
const HEAD_CONCURRENCY = 12;

interface ListObjectsResponse {
  Contents?: ListedR2Object[];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function runAwsJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("aws", args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout) as unknown;
}

async function listR2Objects(bucket: string, endpoint: string): Promise<ListedR2Object[]> {
  const response = (await runAwsJson([
    "s3api",
    "list-objects-v2",
    "--bucket",
    bucket,
    "--endpoint-url",
    endpoint,
    "--output",
    "json",
  ])) as ListObjectsResponse;
  return response.Contents ?? [];
}

async function headR2Object(
  bucket: string,
  endpoint: string,
  key: string,
): Promise<HeadObjectResult | null> {
  try {
    return (await runAwsJson([
      "s3api",
      "head-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--endpoint-url",
      endpoint,
      "--output",
      "json",
    ])) as HeadObjectResult;
  } catch (caught) {
    const error = caught as { stderr?: string };
    if (/Not Found|NoSuchKey|404/i.test(error.stderr ?? "")) {
      return null;
    }
    throw caught;
  }
}

async function main(): Promise<void> {
  const bucket = requireEnv("REFERENCE_R2_BUCKET");
  const endpoint = requireEnv("REFERENCE_R2_ENDPOINT");
  const sources = selectReferenceSources(await listR2Objects(bucket, endpoint));
  const pooledHead = createHeadPool(
    (key) => headR2Object(bucket, endpoint, key),
    HEAD_CONCURRENCY,
  );
  const report = await auditReferenceImages(sources, pooledHead);

  console.log(
    `[reference-audit] ${report.validDerivativeCount}/${report.sourceCount * 2} derivatives valid for ${report.sourceCount} originals`,
  );
  if (report.issues.length > 0) {
    for (const issue of report.issues) {
      console.error(`[reference-audit] ${issue.key}: ${issue.reasons.join(", ")}`);
    }
    throw new Error(`Reference image audit found ${report.issues.length} invalid derivatives`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown reference audit failure");
  process.exitCode = 1;
});
