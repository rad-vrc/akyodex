import assert from 'node:assert/strict';
import test from 'node:test';

import { readAdminCatalogSnapshot } from './admin-catalog-snapshot';

import type { AkyoCsvSnapshot } from './akyo-csv-snapshot';

const HEADER = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author'];
const record = (id: string, category = '動物') => [id, `Akyo ${id}`, `avatar_${id}`, category, '', 'tester'];

const snapshot = (dataRecords: string[][]): AkyoCsvSnapshot => ({
  head: 'a'.repeat(40),
  header: HEADER,
  dataRecords,
  registeredCategories: new Set<string>(),
});

test('保存先の CSV をそのまま行として返し、読んだ head も返す', async () => {
  const result = await readAdminCatalogSnapshot(async () => snapshot([record('0001'), record('0002', '次元')]));
  assert.equal(result.head, 'a'.repeat(40));
  assert.deepEqual(result.rows.map((row) => row.id), ['0001', '0002']);
  assert.equal(result.rows[1].category, '次元');
});

// 公開 JSON にはまだ出ていない登録直後の行も、保存先にはもう入っている。ここが読めないと
// 「同期を待たないと編集できない」に戻る
test('公開 JSON にまだ無い新しい行も返す', async () => {
  const result = await readAdminCatalogSnapshot(async () =>
    snapshot([record('0001'), record('0952', '形状・触り心地')]),
  );
  assert.ok(result.rows.some((row) => row.id === '0952'));
});

/*
 * 失敗を空配列にしない。呼び出し側はこれを完全なスナップショットとして扱うので、空を
 * 成功として返すと画面から全行が消える。
 */
test('取得に失敗したら例外にする。空の成功を作らない', async () => {
  await assert.rejects(
    readAdminCatalogSnapshot(async () => {
      throw new Error('GitHub API 500');
    }),
    /GitHub API 500/,
  );
});

test('1 行も読めなかったら例外にする', async () => {
  await assert.rejects(readAdminCatalogSnapshot(async () => snapshot([])), /1 行も読み取れません/);
});

test('解析結果が CSV の行数と合わなければ例外にする', async () => {
  // ヘッダーだけの壊れた行が混ざると、解析側が落として件数が減る
  await assert.rejects(
    readAdminCatalogSnapshot(async () => snapshot([record('0001'), []])),
    /行数と解析結果が一致しません/,
  );
});

test('ID が重複していたら例外にする', async () => {
  await assert.rejects(
    readAdminCatalogSnapshot(async () => snapshot([record('0001'), record('0001', '次元')])),
    /ID の重複/,
  );
});
