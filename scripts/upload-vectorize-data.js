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
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let batchSize = DEFAULT_BATCH_SIZE;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
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

async function sendBatch(
  records,
  batchIndex,
  { workerUrl, ingestToken },
  retries = 0
) {
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: buildRequestHeaders(ingestToken),
    body: JSON.stringify({ records }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (retries < RETRY_LIMIT) {
      console.warn(
        `  ⚠ Batch ${batchIndex} failed (${res.status}), retrying in ${RETRY_DELAY_MS / 1000}s... (${retries + 1}/${RETRY_LIMIT})`
      );
      await sleep(RETRY_DELAY_MS);
      return sendBatch(
        records,
        batchIndex,
        { workerUrl, ingestToken },
        retries + 1
      );
    }
    throw new Error(
      `Batch ${batchIndex} failed after ${RETRY_LIMIT} retries: ${res.status} ${text}`
    );
  }

  return res.json();
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

  const records = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
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
  sendBatch,
};
