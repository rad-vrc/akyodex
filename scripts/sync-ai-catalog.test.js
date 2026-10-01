const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { reconcileCatalog, validateCatalog } = require('./sync-ai-catalog');
const { createCloudflareClient } = require('./ai-catalog-cloudflare');
const { buildPayload } = require('./generate-vectorize-payload');

function record(id, nickname = `Akyo ${id}`) {
  return { id, nickname, name: '', category: 'Animal', description: '', author: 'author',
    url: '', language: 'ja', entryType: 'avatar' };
}

function harness(rows = [], vectors = rows) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE akyos (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, name TEXT, category TEXT, description TEXT, author TEXT, url TEXT, language TEXT)');
  const columns = ['id', 'nickname', 'name', 'category', 'description', 'author', 'url', 'language'];
  for (const r of rows) db.prepare(`INSERT INTO akyos VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(k => r[k]));
  const index = new Map(vectors.map(r => [r.id, { id: r.id, metadata: { ...r }, values: [1, 2, 3] }]));
  const calls = { embeddings: [], upserts: [], deletes: [], writes: 0 };
  const api = {
    async query(sql, params = []) {
      if (!sql.trim().startsWith('SELECT')) calls.writes++;
      return db.prepare(sql).all(...params).map(row => ({ ...row }));
    },
    async listIds() { return [...index.keys()]; },
    async getVectors(ids) { return ids.flatMap(id => index.has(id) ? [index.get(id)] : []); },
    async embed(records) { calls.embeddings.push(records.map(r => r.id)); return records.map(() => [1, 2, 3]); },
    async upsert(vectors) { calls.upserts.push(vectors); for (const v of vectors) index.set(v.id, v); },
    async remove(ids) { calls.deletes.push(ids); ids.forEach(id => index.delete(id)); },
  };
  return { db, index, api, calls };
}

test('syncs a newly registered MenmeAkyo, edited categories and deletions, then does no writes on repeat', async () => {
  const old = record('0917', 'GamingAkyo');
  const removed = record('0002');
  const current = { ...old, category: 'Color,Color/Rainbow' };
  const menme = record('2030', 'MenmeAkyo');
  const h = harness([old, removed]);
  try {
    // These intentionally tiny lifecycle fixtures approve their large percentage.
    // Unapproved and boundary behavior is tested separately below.
    const summary = await reconcileCatalog([current, menme], h.api, { allowLargeDeletion: true });
    assert.deepEqual(summary, { total: 2, rowsUpdated: 2, vectorsUpdated: 2, rowsDeleted: 1, vectorsDeleted: 1,
      requiresLargeDeletionApproval: true });
    assert.deepEqual((await h.api.query('SELECT * FROM akyos ORDER BY id')).map(r => r.nickname), ['GamingAkyo', 'MenmeAkyo']);
    assert.equal(h.index.get('0917').metadata.category, current.category);
    assert.equal(h.index.has('0002'), false);
    const writes = h.calls.writes;
    await reconcileCatalog([current, menme], h.api);
    assert.equal(h.calls.writes, writes);
    assert.equal(h.calls.embeddings.length, 1);
    assert.equal(h.calls.upserts.length, 1);
  } finally { h.db.close(); }
});

test('repairs Vectorize even when D1 already matches after a partial failure', async () => {
  const before = record('0001');
  const after = { ...before, category: 'Culture' };
  const h = harness([before]);
  try {
    const upsert = h.api.upsert;
    h.api.upsert = async () => { throw new Error('Vectorize unavailable'); };
    await assert.rejects(reconcileCatalog([after], h.api), /Vectorize unavailable/);
    assert.equal((await h.api.query('SELECT * FROM akyos'))[0].category, 'Culture');
    h.api.upsert = upsert;
    const result = await reconcileCatalog([after], h.api);
    assert.equal(result.rowsUpdated, 0);
    assert.equal(result.vectorsUpdated, 1);
    assert.equal(h.index.get('0001').metadata.category, 'Culture');
  } finally { h.db.close(); }
});

test('removes orphan vectors left after D1 deletion and a failed vector deletion', async () => {
  const keep = record('0001');
  const removed = record('0002');
  const h = harness([keep, removed]);
  try {
    const remove = h.api.remove;
    h.api.remove = async () => { throw new Error('delete failed'); };
    await assert.rejects(reconcileCatalog([keep], h.api, { allowLargeDeletion: true }), /delete failed/);
    assert.equal((await h.api.query('SELECT count(*) AS n FROM akyos'))[0].n, 1);
    h.api.remove = remove;
    const result = await reconcileCatalog([keep], h.api, { allowLargeDeletion: true });
    assert.equal(result.rowsDeleted, 0);
    assert.equal(result.vectorsDeleted, 1);
    assert.equal(h.index.has('0002'), false);
  } finally { h.db.close(); }
});

test('dry run reads the remote inventories but neither writes nor generates embeddings', async () => {
  const h = harness([record('0001')]);
  try {
    const result = await reconcileCatalog([record('2030', 'MenmeAkyo')], h.api, { dryRun: true });
    assert.equal(result.rowsUpdated, 1);
    assert.equal(result.rowsDeleted, 1);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.embeddings.length, 0);
    assert.equal(h.index.has('0001'), true);
  } finally { h.db.close(); }
});

test('rejects empty, duplicate, non-JA and malformed catalogs before touching the remote state', async () => {
  for (const input of [[], [record('0001'), record('0001')], [{ ...record('0001'), language: 'en' }],
    [{ ...record('0001'), nickname: '' }], [{ ...record('0001'), category: 123 }]]) {
    let accessed = false;
    await assert.rejects(reconcileCatalog(input, { query() { accessed = true; } }));
    assert.equal(accessed, false);
  }
  assert.equal(validateCatalog([record('2030')]).length, 1);
});

test('refuses to overwrite non-JA data or delete unexpected vector identifiers', async () => {
  for (const foreign of ['language', 'vector']) {
    const h = harness([{ ...record('0001'), language: foreign === 'language' ? 'en' : 'ja' }]);
    try {
      if (foreign === 'vector') h.index.set('en:0001', { id: 'en:0001' });
      await assert.rejects(reconcileCatalog([record('0001')], h.api), /Japanese|identifier/);
      assert.equal(h.calls.writes, 0);
    } finally { h.db.close(); }
  }
});

test('waits for asynchronous vector visibility and fails if it never converges', async () => {
  const r = record('0001');
  const h = harness([], []);
  try {
    h.api.upsert = async () => {};
    await assert.rejects(reconcileCatalog([r], h.api, { pollAttempts: 2, pollDelayMs: 0 }), /Vectorize verification/);
    assert.equal((await h.api.query('SELECT * FROM akyos'))[0].id, r.id);
    h.api.upsert = async vectors => { for (const v of vectors) h.index.set(v.id, v); };
    await reconcileCatalog([r], h.api);
  } finally { h.db.close(); }
});

test('does not delete any records when a vector update fails', async () => {
  const h = harness([record('0001'), record('0002')]);
  try {
    h.api.embed = async () => { throw new Error('AI unavailable'); };
    await assert.rejects(reconcileCatalog([record('2030')], h.api, { allowLargeDeletion: true }), /AI unavailable/);
    assert.equal((await h.api.query('SELECT count(*) AS n FROM akyos'))[0].n, 3);
    assert.deepEqual(h.calls.deletes, []);
  } finally { h.db.close(); }
});

test('reconciles the catalog through the real REST client and SQL, including retry and orphan cleanup', async () => {
  const h = harness([record('0001'), record('0002')]);
  let failOnce = true;
  const api = createCloudflareClient({ accountId: 'account', token: 'fake', databaseId: 'db', indexName: 'index', retryDelayMs: 0,
    fetchImpl: async (url, init) => {
      const endpoint = new URL(url).pathname.split('/').at(-1);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      let result;
      if (endpoint === 'query') result = [{ success: true, results: await h.api.query(body.sql, body.params) }];
      else if (endpoint === 'list') {
        const ids = await h.api.listIds();
        result = { vectors: ids.map(id => ({ id })), count: ids.length, totalCount: ids.length, isTruncated: false };
      } else if (endpoint === 'get_by_ids') result = await h.api.getVectors(body.ids);
      else if (endpoint === 'bge-m3') result = { data: body.text.map(() => [1, 2, 3]) };
      else if (endpoint === 'upsert') {
        if (failOnce) { failOnce = false; return Response.json({ success: false }, { status: 503 }); }
        await h.api.upsert((await body.get('vectors').text()).trim().split('\n').map(line => JSON.parse(line)));
        result = { mutationId: 'upsert' };
      } else if (endpoint === 'delete_by_ids') { await h.api.remove(body.ids); result = { mutationId: 'delete' }; }
      else throw new Error(`Unexpected endpoint: ${endpoint}`);
      return Response.json({ success: true, result });
    } });
  try {
    const source = { data: [{ id: '2030', nickname: 'MenmeAkyo', category: 'Culture', comment: 'new catalog description', avatarUrl: '', author: 'new author' }] };
    await reconcileCatalog(buildPayload(source), api, { allowLargeDeletion: true });
    assert.deepEqual((await h.api.query('SELECT id, nickname FROM akyos')).map(r => [r.id, r.nickname]), [['2030', 'MenmeAkyo']]);
    assert.equal(h.index.size, 1);
    assert.equal(h.index.get('2030').metadata.description, 'new catalog description');
    assert.equal(h.index.get('2030').metadata.category, 'Culture');
    assert.equal((await reconcileCatalog(buildPayload(source), api)).vectorsUpdated, 0);
  } finally { h.db.close(); }
});

test('rewrites legacy whitespace consistently in D1 and vector metadata', async () => {
  const h = harness([{ ...record('0001'), category: ' Animal ' }]);
  try {
    const result = await reconcileCatalog([record('0001')], h.api);
    assert.equal(result.rowsUpdated, 1);
    assert.equal(result.vectorsUpdated, 1);
    assert.equal((await h.api.query('SELECT category FROM akyos'))[0].category, h.index.get('0001').metadata.category);
  } finally { h.db.close(); }
});

test('bounds D1 parameters, embedding batches and vector lookups across multiple batches', async () => {
  const h = harness([record('0001')]);
  try {
    const query = h.api.query;
    h.api.query = async (sql, params = []) => { assert.ok(params.length <= 100); return query(sql, params); };
    const getVectors = h.api.getVectors;
    h.api.getVectors = async ids => { assert.ok(ids.length <= 100); return getVectors(ids); };
    const records = Array.from({ length: 225 }, (_, i) => record(String(i + 10).padStart(4, '0')));
    const result = await reconcileCatalog(records, h.api, { allowLargeDeletion: true });
    assert.equal(result.total, 225);
    assert.equal(h.index.size, 225);
    assert.ok(h.calls.embeddings.every(batch => batch.length <= 20));
    assert.equal(h.calls.embeddings.flat().length, 225);
    assert.equal((await reconcileCatalog(records, h.api)).vectorsUpdated, 0);
  } finally { h.db.close(); }
});

function catalog(count) {
  return Array.from({ length: count }, (_, i) => record(String(i + 1).padStart(4, '0')));
}

test('a 935-to-10 catalog shrink stops before any D1 write, inference or vector mutation', async () => {
  const rows = catalog(935);
  const h = harness(rows);
  const desired = rows.slice(0, 10).map(r => ({ ...r, category: 'Changed category' }));
  try {
    await assert.rejects(reconcileCatalog(desired, h.api), /Large deletion blocked/);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.embeddings.length, 0);
    assert.equal(h.calls.upserts.length, 0);
    assert.equal(h.calls.deletes.length, 0);
    assert.equal(h.index.size, 935);
  } finally { h.db.close(); }
});

test('dry run reports large deletion without writing, while explicit approval permits the same plan', async () => {
  const rows = catalog(935);
  const h = harness(rows);
  try {
    const summary = await reconcileCatalog(rows.slice(0, 10), h.api, { dryRun: true });
    assert.equal(summary.rowsDeleted, 925);
    assert.equal(summary.vectorsDeleted, 925);
    assert.equal(summary.requiresLargeDeletionApproval, true);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.embeddings.length, 0);
    const applied = await reconcileCatalog(rows.slice(0, 10), h.api, { allowLargeDeletion: true });
    assert.deepEqual(applied, summary);
    assert.equal(h.index.size, 10);
    assert.equal((await h.api.query('SELECT count(*) AS n FROM akyos'))[0].n, 10);
  } finally { h.db.close(); }
});

test('deletion limits allow exactly 20 records and 5 percent but block either threshold being exceeded', async () => {
  for (const [total, removed, blocked] of [[1000, 20, false], [1000, 21, true], [100, 5, false], [100, 6, true]]) {
    const rows = catalog(total);
    const h = harness(rows);
    try {
      if (blocked) {
        await assert.rejects(reconcileCatalog(rows.slice(removed), h.api), /Large deletion blocked/);
        assert.equal(h.calls.writes, 0);
      } else {
        await reconcileCatalog(rows.slice(removed), h.api);
        assert.equal(h.index.size, total - removed);
      }
    } finally { h.db.close(); }
  }
});

test('D1 and orphan-vector deletion percentages are checked independently', async () => {
  const rows = catalog(100);
  const desired = rows.slice(6);
  for (const missingFrom of ['D1', 'Vectorize']) {
    const h = harness(missingFrom === 'D1' ? desired : rows, missingFrom === 'Vectorize' ? desired : rows);
    try {
      await assert.rejects(reconcileCatalog(desired, h.api), /Large deletion blocked/);
      assert.equal(h.calls.writes, 0);
      assert.equal(h.calls.deletes.length, 0);
    } finally { h.db.close(); }
  }
});

test('D1 verification detects a successful response that did not persist the requested value', async () => {
  const h = harness([record('0001')]);
  const query = h.api.query;
  h.api.query = async (sql, params) => sql.startsWith('INSERT') ? [] : query(sql, params);
  try {
    await assert.rejects(reconcileCatalog([{ ...record('0001'), category: 'Culture' }], h.api), /D1 verification failed/);
  } finally { h.db.close(); }
});

test('verification waits for deleted vectors as well as updated vectors', async () => {
  const rows = catalog(20);
  const h = harness(rows);
  h.api.remove = async () => {};
  try {
    await assert.rejects(reconcileCatalog(rows.slice(1), h.api, { pollAttempts: 2, pollDelayMs: 0 }), /Vectorize verification timed out/);
    assert.equal(h.index.has('0001'), true);
  } finally { h.db.close(); }
});

test('non-JA D1 rows are rejected even when Vectorize is empty', async () => {
  const h = harness([{ ...record('0001'), language: 'en' }], []);
  try {
    await assert.rejects(reconcileCatalog([record('0001')], h.api), /Japanese rows/);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.embeddings.length, 0);
  } finally { h.db.close(); }
});
