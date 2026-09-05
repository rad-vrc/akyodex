import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLatestAdminCatalog } from './catalog-data-loader';

const row = { id: '0001', nickname: 'Test', avatarName: 'Test', category: 'New category', author: 'Author' };
const payload = (data = [row]) => ({ schemaVersion: 1, language: 'ja', revision: 'a'.repeat(64), count: data.length, data });

test('admin refresh bypasses browser cache and normalizes the newest API data', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /^\/api\/catalog\/ja\?refresh=\d+$/);
    assert.equal(options.cache, 'no-store');
    return Response.json(payload());
  });
  const items = await loadLatestAdminCatalog();
  assert.equal(items[0].category, 'New category');
  assert.equal(items[0].attribute, 'New category');
  assert.equal(items[0].creator, 'Author');
});

test('admin refresh does not fall back to stale snapshots on failure', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 503 });
  });
  await assert.rejects(loadLatestAdminCatalog());
  assert.equal(calls, 1);
});

test('admin refresh rejects partial or duplicate data instead of replacing the editor', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([row, { ...row, id: '' }])));
  await assert.rejects(loadLatestAdminCatalog());
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([row, row])));
  await assert.rejects(loadLatestAdminCatalog());
});

test('admin refresh rejects the wrong language and respects cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...payload(), language: 'en' }));
  await assert.rejects(loadLatestAdminCatalog());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadLatestAdminCatalog(controller.signal), { name: 'AbortError' });
});
