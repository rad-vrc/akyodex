const assert = require('node:assert/strict');
const test = require('node:test');
const { createCloudflareClient } = require('./ai-catalog-cloudflare');

function client(fetchImpl) {
  return createCloudflareClient({ accountId: 'account', token: 'fake-token', databaseId: 'database',
    indexName: 'index', retryDelayMs: 0, timeoutMs: 20, fetchImpl });
}
function success(result) { return Response.json({ success: true, result }); }

test('reads every inventory page using an encoded cursor and rejects incomplete inventories', async () => {
  const paths = [];
  const api = client(async (url, init) => {
    paths.push(new URL(url).search);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer fake-token');
    return success(paths.length === 1
      ? { count: 1, totalCount: 2, vectors: [{ id: '0001' }], isTruncated: true, nextCursor: 'next+page/=' }
      : { count: 1, totalCount: 2, vectors: [{ id: '2030' }], isTruncated: false });
  });
  assert.deepEqual(await api.listIds(), ['0001', '2030']);
  assert.equal(paths[1], '?count=1000&cursor=next%2Bpage%2F%3D');
  await assert.rejects(client(async () => success({ count: 0, totalCount: 1, vectors: [], isTruncated: false })).listIds(), /Incomplete/);
  await assert.rejects(client(async () => success({ count: 0, totalCount: 1, vectors: [], isTruncated: true, nextCursor: 'repeat' })).listIds(), /cursor/);
});

test('uses the Cloudflare D1, AI and Vectorize request contracts including multipart NDJSON', async () => {
  const paths = [];
  const vector = { id: '2030', values: [1, 2], metadata: { nickname: 'MenmeAkyo' } };
  const api = client(async (url, init) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path.endsWith('/query')) {
      assert.deepEqual(JSON.parse(init.body), { sql: 'SELECT * FROM akyos WHERE id = ?', params: ['2030'] });
      return success([{ success: true, results: [{ id: '2030' }] }]);
    }
    if (path.endsWith('/bge-m3')) {
      assert.deepEqual(JSON.parse(init.body), { text: ['MenmeAkyo Animal description author'] });
      return success({ data: [[1, 2]] });
    }
    if (path.endsWith('/upsert')) {
      assert.equal(new URL(url).searchParams.get('unparsable-behavior'), 'error');
      assert.equal(init.headers['Content-Type'], undefined, 'fetch must supply the multipart boundary');
      assert.equal(await init.body.get('vectors').text(), JSON.stringify(vector) + '\n');
      return success({ mutationId: 'upsert' });
    }
    assert.deepEqual(JSON.parse(init.body), { ids: ['2030'] });
    if (path.endsWith('/get_by_ids')) return success([vector]);
    assert.ok(path.endsWith('/delete_by_ids'));
    return success({ mutationId: 'delete' });
  });
  assert.deepEqual(await api.query('SELECT * FROM akyos WHERE id = ?', ['2030']), [{ id: '2030' }]);
  assert.deepEqual(await api.embed([{ nickname: 'MenmeAkyo', category: 'Animal', description: 'description', author: 'author' }]), [[1, 2]]);
  await api.upsert([vector]);
  assert.deepEqual(await api.getVectors(['2030']), [vector]);
  await api.remove(['2030']);
  assert.equal(paths.length, 5);
});

test('bounds retries, retries transient failures and refuses false success or unacknowledged writes', async () => {
  let calls = 0;
  const api = client(async () => ++calls < 3
    ? Response.json({ success: false }, { status: calls === 1 ? 429 : 503 })
    : success([]));
  assert.deepEqual(await api.getVectors(['0001']), []);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(client(async () => { calls++; throw new Error('secret response'); }).getVectors([]), /failed or timed out/);
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(client(async () => { calls++; return new Response('private upstream error', { status: 403 }); }).getVectors([]), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(client(async () => success([{ success: false, results: [] }])).query('SELECT 1'), /failed D1/);
  await assert.rejects(client(async () => success({})).remove(['0001']), /not acknowledged/);
  await assert.rejects(client(async () => Response.json(null)).getVectors([]), /Cloudflare API failed/);
});

test('one request deadline also covers a body that never finishes', async () => {
  let calls = 0;
  // Keep Node alive while AbortSignal.timeout uses an unreferenced timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const api = client(async (_url, init) => {
      calls++;
      return { ok: true, status: 200, json: () => new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }) };
    });
    await assert.rejects(api.getVectors([]), /failed or timed out/);
    assert.equal(calls, 4);
  } finally { clearInterval(keepAlive); }
});

test('API errors never include upstream bodies or request credentials', async () => {
  await assert.rejects(client(async () => Response.json({ success: false,
    errors: [{ code: 10000, message: 'PRIVATE_BODY_CANARY' }], result: { description: 'CATALOG_TEXT_CANARY' },
  }, { status: 403 })).getVectors(['0001']), error => {
    assert.match(error.message, /HTTP 403; codes 10000/);
    assert.doesNotMatch(error.message, /PRIVATE_BODY_CANARY|CATALOG_TEXT_CANARY|fake-token/);
    return true;
  });
});
