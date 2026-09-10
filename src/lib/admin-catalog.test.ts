import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCatalogRefresh, applyCategoryRowChanges, recordCommittedRows } from './admin-catalog';
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

test('applyCatalogRefresh keeps a committed row when the fetch is behind, and yields to real changes', () => {
  const before = akyo('0001');
  const saved = akyo('0001', { category: '動物,乗り物', attribute: '動物,乗り物' });
  const { catalog, committed } = recordCommittedRows([before, akyo('0002')], new Map(), [saved], [getAkyoEditFields(before)]);

  // The public JSON has not caught up yet: our own commit must survive the refresh.
  const stale = applyCatalogRefresh([before, akyo('0002')], committed);
  assert.equal(stale.catalog[0].category, '動物,乗り物');
  assert.equal(stale.committed.has('0001'), true, 'still watching for the sync');

  // The fetch caught up: stop overriding, but keep watching. Dropping the record here let a
  // later stale response read as somebody else's edit and undo the commit on screen.
  const caughtUp = applyCatalogRefresh([saved, akyo('0002')], committed);
  assert.equal(caughtUp.catalog[0].category, '動物,乗り物');
  assert.equal(caughtUp.committed.has('0001'), true);

  // Someone else edited the row afterwards: their version wins over ours.
  const external = akyo('0001', { nickname: 'edited elsewhere', category: '次元', attribute: '次元' });
  const outside = applyCatalogRefresh([external, akyo('0002')], committed);
  assert.equal(outside.catalog[0].nickname, 'edited elsewhere');
  assert.equal(outside.committed.has('0001'), false);

  // A row deleted remotely simply disappears.
  assert.deepEqual(applyCatalogRefresh([akyo('0002')], committed).catalog.map((row) => row.id), ['0002']);
  assert.equal(catalog.length, 2);
});

/*
 * 「データを再取得」は /api/catalog/ja を読む。これは公開カタログで、管理画面が書いた
 * CSV より遅れる（同期ワークフローが回るまで）。追いついた版が一度返ってきたあとでも、
 * 次の取得が古い応答を返すことはある（エッジやキャッシュ差）。
 *
 * 以前は追いついた時点で記録を捨てていたので、そのあと古い応答を掴むと「誰かが元に
 * 戻した」と読んで、付けたばかりのカテゴリが画面から消えていた（2026-09-10 報告）。
 */
test('applyCatalogRefresh keeps protecting a commit after the fetch has already caught up once', () => {
  const before = akyo('0001', { category: 'チョコミント類', attribute: 'チョコミント類' });
  const saved = akyo('0001', { category: 'チョコミント類,生ける伝説', attribute: 'チョコミント類,生ける伝説' });
  const committed = recordCommittedRows([before], new Map(), [saved], [getAkyoEditFields(before)]).committed;

  const caughtUp = applyCatalogRefresh([saved], committed);
  assert.equal(caughtUp.catalog[0].category, 'チョコミント類,生ける伝説');

  // 同じ session でもう一度「データを再取得」。今度は古い応答が返ってきた
  const again = applyCatalogRefresh([before], caughtUp.committed);
  assert.equal(again.catalog[0].category, 'チョコミント類,生ける伝説', '付けたカテゴリが消えている');
  assert.equal(again.committed.has('0001'), true);

  // 何度繰り返しても同じ。ここが緩むと、押すたびに結果が変わる画面になる
  const third = applyCatalogRefresh([before], again.committed);
  assert.equal(third.catalog[0].category, 'チョコミント類,生ける伝説');

  // 追いついた後でも、本物の別編集にはこれまでどおり譲る
  const external = akyo('0001', { category: '次元', attribute: '次元', nickname: 'edited elsewhere' });
  const outside = applyCatalogRefresh([external], again.committed);
  assert.equal(outside.catalog[0].nickname, 'edited elsewhere');
  assert.equal(outside.committed.has('0001'), false);
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

test('a rename is recorded like any other commit, so a lagging refresh cannot undo it', () => {
  // A row this session never saved: the rename itself is the first committed version.
  const untouched = [akyo('0001'), akyo('0002')];
  const renamed = applyCategoryRowChanges(untouched, new Map(), [{ id: '0001', category: '生物' }]);
  assert.equal(renamed.committed.get('0001')?.data.category, '生物');
  assert.deepEqual(renamed.committed.get('0001')?.before.map((fields) => fields.category), ['動物']);
  const stale = applyCatalogRefresh(untouched, renamed.committed);
  assert.equal(stale.catalog[0].category, '生物', 'the pre-rename JSON must not win');

  // A row saved first and renamed afterwards: both intermediate versions are known.
  const saved = recordCommittedRows(untouched, new Map(), [akyo('0001', { category: '動物,乗り物', attribute: '動物,乗り物' })], [getAkyoEditFields(untouched[0])]);
  const both = applyCategoryRowChanges(saved.catalog, saved.committed, [{ id: '0001', category: '生物,乗り物' }]);
  assert.deepEqual(both.committed.get('0001')?.before.map((fields) => fields.category), ['動物', '動物,乗り物']);
  for (const lagging of ['動物', '動物,乗り物']) {
    const refreshed = applyCatalogRefresh([akyo('0001', { category: lagging, attribute: lagging }), akyo('0002')], both.committed);
    assert.equal(refreshed.catalog[0].category, '生物,乗り物', `JSON still at ${lagging}`);
  }
  // A genuine external edit still wins over the rename.
  const external = applyCatalogRefresh([akyo('0001', { nickname: 'edited elsewhere', category: '次元', attribute: '次元' }), akyo('0002')], both.committed);
  assert.equal(external.catalog[0].category, '次元');
});
