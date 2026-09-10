import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_CATALOG_NO_STORE, handleAdminCatalogRequest } from './admin-catalog-handler';

import type { AdminCatalogSnapshot } from '@/lib/admin-catalog-snapshot';
import type { AkyoData } from '@/types/akyo';

function akyo(id: string): AkyoData {
  const url = `https://vrchat.com/home/avatar/avtr_${id}`;
  return {
    id, nickname: `Akyo ${id}`, avatarName: `avatar_${id}`, author: 'tester', creator: 'tester',
    category: '動物', attribute: '動物', comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url, avatarUrl: url,
  };
}

const snapshot: AdminCatalogSnapshot = { head: 'a'.repeat(40), rows: [akyo('0001'), akyo('0002')] };

/*
 * この応答は認証済みの本文をそのまま含む。共有キャッシュや中間プロキシに載ると、
 * (1) 別の管理者が古い一覧を掴んで削除と遅延を取り違える、(2) 401 が残ってログイン後も
 * 弾かれ続ける。どちらもヘッダ 1 行が消えるだけで起きて、画面上は正常に見える。
 */
test('成功・認証切れ・失敗のどれも、共有キャッシュに載せないヘッダを付ける', async () => {
  const expected = ADMIN_CATALOG_NO_STORE['Cache-Control'];
  assert.equal(expected, 'private, no-store, max-age=0');

  const ok = await handleAdminCatalogRequest({
    validateSession: async () => ({ role: 'owner' }),
    readSnapshot: async () => snapshot,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), expected);

  const unauthorized = await handleAdminCatalogRequest({
    validateSession: async () => null,
    readSnapshot: async () => snapshot,
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('Cache-Control'), expected);

  const failed = await handleAdminCatalogRequest({
    validateSession: async () => ({ role: 'owner' }),
    readSnapshot: async () => { throw new Error('boom'); },
  });
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('Cache-Control'), expected);
});

test('認証が無ければスナップショットを読まない', async () => {
  let reads = 0;
  const response = await handleAdminCatalogRequest({
    validateSession: async () => null,
    readSnapshot: async () => { reads += 1; return snapshot; },
  });
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
  assert.equal((await response.json()).success, false);
});

test('count は data の件数。呼び出し側が欠けた応答を見分けるための数', async () => {
  const response = await handleAdminCatalogRequest({
    validateSession: async () => ({ role: 'owner' }),
    readSnapshot: async () => snapshot,
  });
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.head, snapshot.head);
  assert.equal(body.count, body.data.length);
  assert.equal(body.count, 2);
});

test('読み取りに失敗しても、空配列を成功として返さない', async () => {
  const response = await handleAdminCatalogRequest({
    validateSession: async () => ({ role: 'owner' }),
    readSnapshot: async () => { throw new Error('CSV を読めません'); },
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.data, undefined, '空の一覧を渡すと、呼び出し側が全行を消す');
});
