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

  // The fetch caught up: stop overriding.
  const caughtUp = applyCatalogRefresh([saved, akyo('0002')], committed);
  assert.equal(caughtUp.catalog[0].category, '動物,乗り物');
  assert.equal(caughtUp.committed.has('0001'), false);

  // Someone else edited the row afterwards: their version wins over ours.
  const external = akyo('0001', { nickname: 'edited elsewhere', category: '次元', attribute: '次元' });
  const outside = applyCatalogRefresh([external, akyo('0002')], committed);
  assert.equal(outside.catalog[0].nickname, 'edited elsewhere');
  assert.equal(outside.committed.has('0001'), false);

  // A row deleted remotely simply disappears.
  assert.deepEqual(applyCatalogRefresh([akyo('0002')], committed).catalog.map((row) => row.id), ['0002']);
  assert.equal(catalog.length, 2);
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
