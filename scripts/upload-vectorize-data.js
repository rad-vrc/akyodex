#!/usr/bin/env node
/**
 * Upload vectorize payload to akyo-search-worker in batches.
 *
 * Usage: node scripts/upload-vectorize-data.js [--batch-size 50] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_WORKER_URL =
  'https://akyo-search-worker.dorado1031.workers.dev/insert-data';
const INGEST_TOKEN_ENV = 'AKYO_INGEST_TOKEN';
const WORKER_URL_ENV = 'AKYO_WORKER_URL';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 1000;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args = process.argv.slice(2)) {
  let batchSize = DEFAULT_BATCH_SIZE;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size') {
      const value = args[i + 1];
      const parsed = Number(value);
      if (
        !value ||
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_BATCH_SIZE
      ) {
        throw new Error(
          `--batch-size must be an integer from 1 through ${MAX_BATCH_SIZE}`
        );
      }
      batchSize = parsed;
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { batchSize, dryRun };
}

function getIngestToken(environment = process.env) {
  const token = environment[INGEST_TOKEN_ENV]?.trim();
  if (!token) {
    throw new Error(`${INGEST_TOKEN_ENV} is not configured`);
  }
  return token;
}

function getWorkerUrl(environment = process.env) {
  return environment[WORKER_URL_ENV]?.trim() || DEFAULT_WORKER_URL;
}

function buildRequestHeaders(ingestToken) {
  if (!ingestToken) {
    throw new Error('ingest token is required');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ingestToken}`,
  };
}

function validateRecordsPayload(value) {
  if (!Array.isArray(value)) {
    throw new Error('vectorize-payload.json must contain a records array');
  }
  return value;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function responseSummary(text) {
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

async function retryBatch(records, batchIndex, options, retries, reason) {
  if (retries >= RETRY_LIMIT) {
    throw new Error(
      `Batch ${batchIndex} failed after ${RETRY_LIMIT} retries: ${reason}`
    );
  }

  const delayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  console.warn(
    `  ⚠ Batch ${batchIndex} failed (${reason}), retrying in ${delayMs / 1000}s... (${retries + 1}/${RETRY_LIMIT})`
  );
  await sleep(delayMs);
  return sendBatch(records, batchIndex, options, retries + 1);
}

async function sendBatch(records, batchIndex, options, retries = 0) {
  const { workerUrl, ingestToken } = options;
  let res;
  try {
    res = await fetch(workerUrl, {
      method: 'POST',
      headers: buildRequestHeaders(ingestToken),
      body: JSON.stringify({ records }),
      signal: AbortSignal.timeout(
        options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
      ),
    });
  } catch (error) {
    return retryBatch(
      records,
      batchIndex,
      options,
      retries,
      `network error: ${errorMessage(error)}`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    const reason = `HTTP ${res.status}: ${responseSummary(text)}`;
    if (isRetryableStatus(res.status)) {
      return retryBatch(records, batchIndex, options, retries, reason);
    }
    throw new Error(`Batch ${batchIndex} failed without retry: ${reason}`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return retryBatch(
      records,
      batchIndex,
      options,
      retries,
      'success response was not valid JSON'
    );
  }

  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return retryBatch(
      records,
      batchIndex,
      options,
      retries,
      'success response was not a JSON object'
    );
  }

  if (result?.ok === false || Number(result?.failed) > 0) {
    return retryBatch(
      records,
      batchIndex,
      options,
      retries,
      `application failure: ${responseSummary(text)}`
    );
  }

  return result;
}

async function main() {
  const { batchSize, dryRun } = parseArgs();
  const workerUrl = getWorkerUrl();
  const payloadPath = path.resolve(__dirname, '..', 'data', 'vectorize-payload.json');

  if (!fs.existsSync(payloadPath)) {
    console.error(`ペイロードファイルがありません: ${payloadPath}`);
    console.error('先に node scripts/generate-vectorize-payload.js を実行してください');
    process.exit(1);
  }

  const records = validateRecordsPayload(
    JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
  );
  const totalBatches = Math.ceil(records.length / batchSize);

  console.log(`Records: ${records.length}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Total batches: ${totalBatches}`);
  console.log(`Endpoint: ${workerUrl}`);
  if (dryRun) {
    console.log('\n--dry-run: 実際には送信しません');
    return;
  }
  const ingestToken = getIngestToken();
  console.log('');

  let totalProcessed = 0;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const batch = records.slice(start, start + batchSize);
    const idRange = `${batch[0].id}–${batch[batch.length - 1].id}`;

    process.stdout.write(
      `  [${i + 1}/${totalBatches}] ${idRange} (${batch.length} records)...`
    );

    const result = await sendBatch(batch, i + 1, {
      workerUrl,
      ingestToken,
    });
    totalProcessed += result.processed || 0;
    console.log(` ✓ processed: ${result.processed}`);

    // Small delay between batches to avoid rate limits
    if (i < totalBatches - 1) {
      await sleep(1000);
    }
  }

  console.log(`\n✅ Done! Total processed: ${totalProcessed}/${records.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  buildRequestHeaders,
  getIngestToken,
  getWorkerUrl,
  isRetryableStatus,
  parseArgs,
  sendBatch,
  validateRecordsPayload,
};
