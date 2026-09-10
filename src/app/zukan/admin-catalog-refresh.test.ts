import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAdminCsvCatalog } from './catalog-data-loader';

/**
 * 管理画面の再取得は、遅れる公開カタログではなく保存先の CSV スナップショットを読む
 * （/api/admin/catalog）。遅延と削除を区別できるようにするため。
 *
 * 失敗は必ず例外にする。空配列を成功として返すと、呼び出し側がそれを完全なスナップショット
 * として扱い、一覧と保留を失う。
 */

const row = { id: '0001', nickname: 'Test', avatarName: 'Test', category: 'New category', author: 'Author' };
const payload = (data: unknown[] = [row]) => ({ success: true, head: 'a'.repeat(40), count: data.length, data });

test('管理用再取得は保存先の CSV を、ブラウザキャッシュを使わずに読む', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /^\/api\/admin\/catalog\?refresh=\d+$/, '公開カタログを読んではいけない');
    assert.equal(options.cache, 'no-store');
    return Response.json(payload());
  });
  const { head, rows } = await loadAdminCsvCatalog();
  assert.equal(head, 'a'.repeat(40), 'どの版を読んだか追えること');
  assert.equal(rows[0].category, 'New category');
});

test('管理用 API の失敗で、古いスナップショットへ落ちない', async (t) => {
  for (const response of [
    () => new Response('', { status: 503 }),
    () => new Response('', { status: 401 }),
    () => Response.json({ success: false, error: '保存先の最新データを取得できませんでした。' }),
  ]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return response();
    });
    await assert.rejects(loadAdminCsvCatalog());
    assert.equal(calls, 1, '公開カタログへ問い合わせ直してはいけない');
  }
});

test('空・重複・欠けた応答は、一覧を置き換えずに例外にする', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([])));
  await assert.rejects(loadAdminCsvCatalog(), '空配列を完全なスナップショットとして扱わない');
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([row, row])));
  await assert.rejects(loadAdminCsvCatalog());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, count: 1, data: [row] }));
  await assert.rejects(loadAdminCsvCatalog(), 'head の無い応答は受け取らない');
});

test('取り消しは中断として返る', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return Response.json(payload());
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadAdminCsvCatalog(controller.signal), { name: 'AbortError' });
});
