#!/usr/bin/env node
const { readFileSync, appendFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { buildPayload } = require('./generate-vectorize-payload');
const { createCloudflareClient } = require('./ai-catalog-cloudflare');

const COLUMNS = ['id', 'nickname', 'name', 'category', 'description', 'author', 'url', 'language'];
const MAX_RECORDS = 10_000;
const MAX_AUTO_DELETIONS = 20;
const MAX_AUTO_DELETION_PERCENT = 5;

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
}

function canonical(record) {
  return Object.fromEntries(COLUMNS.map(key => [key, typeof record?.[key] === 'string' ? record[key].trim() : '']));
}

function sameRecord(left, right) {
  return Boolean(left && right) && COLUMNS.every(key => (left[key] ?? '') === (right[key] ?? ''));
}

function validateCatalog(records) {
  if (!Array.isArray(records) || !records.length || records.length > MAX_RECORDS) {
    throw new Error('Expected a non-empty Japanese catalog of at most 10000 records');
  }
  const ids = new Set();
  return records.map(record => {
    if (!record || COLUMNS.some(key => typeof record[key] !== 'string') ||
      !/^\d{4}$/.test(record.id) || !record.nickname.trim() || record.language !== 'ja' ||
      !['avatar', 'world'].includes(record.entryType) || ids.has(record.id)) {
      throw new Error('Invalid or duplicate Japanese catalog record');
    }
    ids.add(record.id);
    return { ...canonical(record), entryType: record.entryType };
  });
}

async function readVectors(api, ids) {
  const vectors = new Map();
  // The live get_by_ids endpoint rejects requests containing more than 20 IDs.
  for (const batch of chunks(ids, 20)) {
    const response = await api.getVectors(batch);
    if (!Array.isArray(response)) throw new Error('Invalid Vectorize inventory');
    for (const vector of response) {
      if (!batch.includes(vector.id) || vectors.has(vector.id) || vector.namespace ||
        (vector.metadata?.language && vector.metadata.language !== 'ja')) {
        throw new Error('Expected only Japanese vectors with catalog identifiers');
      }
      vectors.set(vector.id, vector);
    }
  }
  return vectors;
}

async function reconcileCatalog(input, api, options = {}) {
  const records = validateCatalog(input);
  const desired = new Map(records.map(record => [record.id, record]));
  const rows = await api.query(`SELECT ${COLUMNS.join(', ')} FROM akyos`);
  if (!Array.isArray(rows) || rows.some(row => row.language !== 'ja' || !/^\d{4}$/.test(row.id))) {
    throw new Error('Expected only Japanese rows in the existing search database');
  }
  const current = new Map(rows.map(row => [row.id, row]));
  if (current.size !== rows.length) throw new Error('Duplicate search database identifiers');
  const vectorIds = await api.listIds();
  if (!Array.isArray(vectorIds) || vectorIds.some(id => !/^\d{4}$/.test(id)) || new Set(vectorIds).size !== vectorIds.length) {
    throw new Error('Unexpected Vectorize identifier; refusing destructive reconciliation');
  }
  // Read both stores. A prior failed upload may have changed D1 but not Vectorize.
  const vectors = await readVectors(api, [...new Set([...vectorIds, ...desired.keys()])]);
  const changedRows = records.filter(record => !sameRecord(record, current.get(record.id)));
  const changedVectors = records.filter(record => !sameRecord(record, vectors.get(record.id)?.metadata) ||
    vectors.get(record.id)?.metadata?.entryType !== record.entryType);
  const removedRows = rows.filter(row => !desired.has(row.id)).map(row => row.id);
  const removedVectors = vectorIds.filter(id => !desired.has(id));
  const requiresLargeDeletionApproval = [[removedRows.length, rows.length], [removedVectors.length, vectorIds.length]]
    .some(([count, total]) => count > MAX_AUTO_DELETIONS || count * 100 > total * MAX_AUTO_DELETION_PERCENT);
  const summary = { total: records.length, rowsUpdated: changedRows.length, vectorsUpdated: changedVectors.length,
    rowsDeleted: removedRows.length, vectorsDeleted: removedVectors.length, requiresLargeDeletionApproval };
  options.log?.(JSON.stringify(summary));
  if (options.dryRun) return summary;
  if (requiresLargeDeletionApproval && options.allowLargeDeletion !== true) {
    throw new Error(`Large deletion blocked before any write (D1 ${removedRows.length}/${rows.length}; ` +
      `Vectorize ${removedVectors.length}/${vectorIds.length}). Review a dry run and explicitly approve a manual apply.`);
  }

  // D1 serves current fields for all search results. Semantic ranking can use an
  // older embedding until Vectorize catches up, without returning its stale text.
  for (const batch of chunks(changedRows, 10)) {
    await api.query(`INSERT OR REPLACE INTO akyos (${COLUMNS.join(', ')}) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      batch.flatMap(record => COLUMNS.map(key => record[key])));
  }
  for (const batch of chunks(changedVectors, 20)) {
    const embeddings = await api.embed(batch);
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length || embeddings.some(vector =>
      !Array.isArray(vector) || !vector.length || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error('Embedding response was incomplete or invalid');
    }
    await api.upsert(batch.map((record, i) => ({ id: record.id, values: embeddings[i], metadata: record })));
    options.log?.(`Submitted ${batch.length} vectors (${batch[0].id}..${batch.at(-1).id})`);
  }

  // Never prune during a failed update. On a failed deletion the orphan remains
  // discoverable in the next vector inventory and can be removed on retry.
  for (const batch of chunks(removedRows, 50)) {
    await api.query(`DELETE FROM akyos WHERE language = 'ja' AND id IN (${batch.map(() => '?').join(', ')})`, batch);
  }
  for (const batch of chunks(removedVectors, 100)) await api.remove(batch);

  const verifiedRows = await api.query(`SELECT ${COLUMNS.join(', ')} FROM akyos`);
  if (verifiedRows.length !== records.length || verifiedRows.some(row => !sameRecord(row, desired.get(row.id)))) {
    throw new Error('D1 verification failed; rerun from current main');
  }
  // Vectorize mutations are asynchronous; accepted is not yet indexed/visible.
  const verifyIds = [...new Set([...desired.keys(), ...removedVectors])];
  for (let attempt = 0; attempt < (options.pollAttempts ?? 40); attempt++) {
    const visible = await readVectors(api, verifyIds);
    if (records.every(record => sameRecord(record, visible.get(record.id)?.metadata) &&
      visible.get(record.id)?.metadata?.entryType === record.entryType) && removedVectors.every(id => !visible.has(id))) return summary;
    await sleep(options.pollDelayMs ?? 3000);
  }
  throw new Error('Vectorize verification timed out; rerun to reconcile both stores');
}

function parseRunOptions(args, env = process.env) {
  if (args.some(arg => !['--dry-run', '--apply', '--allow-large-deletion'].includes(arg)) ||
    new Set(args).size !== args.length || args.filter(arg => ['--dry-run', '--apply'].includes(arg)).length !== 1) {
    throw new Error('Use --dry-run or --apply, optionally --allow-large-deletion for a manual apply; writes are never the default');
  }
  const apply = args.includes('--apply');
  const allowLargeDeletion = args.includes('--allow-large-deletion');
  if (allowLargeDeletion && (!apply || env.GITHUB_EVENT_NAME !== 'workflow_dispatch')) {
    throw new Error('Large-deletion approval is only accepted with a manual workflow_dispatch --apply');
  }
  if (apply && (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
    env.AI_CATALOG_SYNC_ENABLED !== 'true')) {
    throw new Error('Apply requires the enabled, serialized main-branch Sync AI Catalog workflow');
  }
  return { dryRun: !apply, allowLargeDeletion };
}

async function main(args = process.argv.slice(2)) {
  const options = parseRunOptions(args);
  const root = resolve(__dirname, '..');
  const config = JSON.parse(readFileSync(resolve(root, 'workers/akyo-search-worker/wrangler.jsonc'), 'utf8'));
  const records = buildPayload(JSON.parse(readFileSync(resolve(root, 'data/akyo-data-ja.json'), 'utf8')));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const api = createCloudflareClient({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.AI_CATALOG_SYNC_API_TOKEN, databaseId: config.d1_databases.find(b => b.binding === 'DB').database_id,
    indexName: config.vectorize.find(b => b.binding === 'VECTORIZE').index_name });
  const summary = await reconcileCatalog(records, api, { ...options, log: console.log });
  console.log(JSON.stringify({ revision, ...options, ...summary }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## AI catalog sync\n\nSource: \`${revision}\` (JA)\n\n` +
      `Mode: ${options.dryRun ? 'dry-run' : 'apply'}; large-deletion override: ${options.allowLargeDeletion}\n\n` +
      `\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { reconcileCatalog, validateCatalog, parseRunOptions };
