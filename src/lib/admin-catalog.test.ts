import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAdminSnapshot, applyCategoryRowChanges, createAdminCatalogSync, recordCommittedRows } from './admin-catalog';
import { getAkyoEditFields } from './akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

function akyo(id: string, overrides: Partial<AkyoData> = {}): AkyoData {
  const url = `https://vrchat.com/home/avatar/avtr_${id}`;
  return {
    id, nickname: `Akyo ${id}`, avatarName: `avatar_${id}`, author: 'tester', creator: 'tester',
    category: '動物', attribute: '動物', comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url, avatarUrl: url, ...overrides,
  };
}

test('recordCommittedRows merges saved rows into the catalog and stacks what they replaced', () => {
  const catalog = [akyo('0001'), akyo('0002')];
  const first = recordCommittedRows(catalog, new Map(), [akyo('0001', { category: '動物,乗り物', attribute: '動物,乗り物' })], [getAkyoEditFields(catalog[0])]);
  assert.equal(first.catalog[0].category, '動物,乗り物');
  assert.equal(first.catalog[1], catalog[1], 'untouched rows keep their identity');
  assert.equal(first.committed.get('0001')?.before.length, 1);

  const second = recordCommittedRows(first.catalog, first.committed, [akyo('0001', { nickname: 'renamed', category: '動物,乗り物', attribute: '動物,乗り物' })], [getAkyoEditFields(first.catalog[0])]);
  assert.equal(second.catalog[0].nickname, 'renamed');
  assert.deepEqual(second.committed.get('0001')?.before.map((fields) => fields.nickname), ['Akyo 0001', 'Akyo 0001']);
});

/*
 * 「データを再取得」は /api/admin/catalog を読む。書き込み側が競合判定に使うのと同じ CSV
 * スナップショットなので、内容を選び直す余地が無い。かつては公開カタログ（KV/R2）を読んで
 * いて遅れるため、置き換えた版のスナップショットを持ち歩いて遅延を見分けていた。
 */
test('applyAdminSnapshot takes the saved CSV as it is and folds the commit record', () => {
  const before = akyo('0001', { category: 'チョコミント類', attribute: 'チョコミント類' });
  const saved = akyo('0001', { category: 'チョコミント類,生ける伝説', attribute: 'チョコミント類,生ける伝説' });
  const committed = recordCommittedRows([before, akyo('0002')], new Map(), [saved], [getAkyoEditFields(before)]).committed;
  assert.equal(committed.has('0001'), true);

  const snapshot = applyAdminSnapshot([saved, akyo('0002')]);
  assert.equal(snapshot.catalog[0].category, 'チョコミント類,生ける伝説');
  assert.equal(snapshot.committed.size, 0, '遅延を見分けるための記録はもう要らない');
});

// 公開カタログ相手だと、これは「遅れた応答」と見分けが付かないので取り込めなかった。
// 保存先そのものを読むなら、書いてある内容が答え
test('applyAdminSnapshot reflects an external revert to the pre-change content', () => {
  const before = akyo('0001', { category: 'チョコミント類', attribute: 'チョコミント類' });
  const saved = akyo('0001', { category: 'チョコミント類,生ける伝説', attribute: 'チョコミント類,生ける伝説' });
  const committed = recordCommittedRows([before], new Map(), [saved], [getAkyoEditFields(before)]).committed;

  const snapshot = applyAdminSnapshot([before]);
  assert.equal(snapshot.catalog[0].category, 'チョコミント類', '他の人が戻したなら、それが現在の内容');
  assert.equal(snapshot.committed.size, 0);
  assert.equal(committed.size, 1, '渡した記録は変更しない');
});

test('applyAdminSnapshot drops a row the saved CSV no longer has, and takes rows it gained', () => {
  const committed = recordCommittedRows([akyo('0001'), akyo('0002')], new Map(), [akyo('0002', { nickname: 'saved' })], []).committed;
  // 0002 は本当に削除された。遅れない情報源なので「まだ同期されていない」ではない
  const snapshot = applyAdminSnapshot([akyo('0001'), akyo('0953')]);
  assert.deepEqual(snapshot.catalog.map((row) => row.id), ['0001', '0953']);
  assert.equal(committed.has('0002'), true, '渡した記録は変更しない');
});

/*
 * 再取得はスナップショットの head 時点しか語れない。取得を始めたあとに保存が通っていれば、
 * 正しい CSV でも画面が持っている保存結果より古い。遅れて届いた応答をそのまま採用すると、
 * 保存したばかりの内容が巻き戻る。
 */
test('createAdminCatalogSync refuses a response that a save overtook while it was in flight', () => {
  const applied: AkyoData[][] = [];
  const sync = createAdminCatalogSync((rows: AkyoData[]) => {
    applied.push(rows);
  });

  // 取得開始 → その間に保存が通る → 応答が届く
  const token = sync.begin();
  sync.noteCommit();
  assert.equal(sync.apply([akyo('0001')], token), false, '保存が入ったあとの古い応答は使わない');
  assert.equal(applied.length, 0, '巻き戻さない');

  // 取り直せば通る
  const retry = sync.begin();
  assert.equal(sync.apply([akyo('0001', { nickname: 'fresh' })], retry), true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0].nickname, 'fresh');

  // 保存が無ければ何度でも通る
  assert.equal(sync.apply([akyo('0002')], sync.begin()), true);
  assert.equal(applied.length, 2);
});

test('applyCategoryRowChanges patches the catalog and the committed rows a rename rewrote', () => {
  const before = akyo('0001');
  const { catalog, committed } = recordCommittedRows([before, akyo('0002')], new Map(), [akyo('0001', { category: '動物,乗り物', attribute: '動物,乗り物' })], [getAkyoEditFields(before)]);
  const renamed = applyCategoryRowChanges(catalog, committed, [{ id: '0001', category: '生物,乗り物' }]);
  assert.equal(renamed.catalog[0].category, '生物,乗り物');
  assert.equal(renamed.catalog[0].attribute, '生物,乗り物');
  assert.equal(renamed.committed.get('0001')?.data.category, '生物,乗り物');
  assert.equal(renamed.catalog[1], catalog[1]);
  assert.equal(applyCategoryRowChanges(catalog, committed, []).catalog, catalog);
});

test('a rename reaches the catalog without waiting for a refresh', () => {
  // A row this session never saved: the rename itself is the first committed version.
  const untouched = [akyo('0001'), akyo('0002')];
  const renamed = applyCategoryRowChanges(untouched, new Map(), [{ id: '0001', category: '生物' }]);
  assert.equal(renamed.catalog[0].category, '生物');
  assert.equal(renamed.committed.get('0001')?.data.category, '生物');
  assert.deepEqual(renamed.committed.get('0001')?.before.map((fields) => fields.category), ['動物']);

  // A row saved first and renamed afterwards: both intermediate versions are known.
  const saved = recordCommittedRows(untouched, new Map(), [akyo('0001', { category: '動物,乗り物', attribute: '動物,乗り物' })], [getAkyoEditFields(untouched[0])]);
  const both = applyCategoryRowChanges(saved.catalog, saved.committed, [{ id: '0001', category: '生物,乗り物' }]);
  assert.equal(both.catalog[0].category, '生物,乗り物');
  assert.deepEqual(both.committed.get('0001')?.before.map((fields) => fields.category), ['動物', '動物,乗り物']);
});
