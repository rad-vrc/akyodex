import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCatalog } from './catalog-filter';
import type { AkyoData } from '@/types/akyo';

const item = (id: string, category: string, author: string, entryType: 'avatar' | 'world' = 'avatar'): AkyoData => ({
  id, nickname: 'テストAkyo', avatarName: 'Test', category, author, entryType,
  appearance: '', attribute: category, creator: author, comment: '', notes: '', avatarUrl: '',
});
const data = [
  item('0001', '動物,動物/ねこ,Booth', '作者A、作者B'),
  item('0002', '動物,動物/いぬ', '作者B'),
  item('0003', 'ワールド', '作者C', 'world'),
];
const ids = (items: AkyoData[]) => items.map(value => value.id);

test('shared filter combines category OR/AND and multiple authors', () => {
  assert.deepEqual(ids(filterCatalog(data, { categories: ['動物/ねこ', '動物/いぬ'] })), ['0001', '0002']);
  assert.deepEqual(ids(filterCatalog(data, { categories: ['動物', 'Booth'], categoryMatchMode: 'and' })), ['0001']);
  assert.deepEqual(ids(filterCatalog(data, { authors: ['作者B', '作者C'] })), ['0001', '0002', '0003']);
  assert.deepEqual(ids(filterCatalog(data, { categories: ['動物'], authors: ['作者A'] })), ['0001']);
});

test('shared search normalizes case and kana and supports internal IDs', () => {
  assert.equal(filterCatalog(data, { searchQuery: 'てすと' }).length, 3);
  assert.equal(filterCatalog(data, { searchQuery: 'TEST' }).length, 3);
  assert.deepEqual(ids(filterCatalog(data, { searchQuery: '0002' })), ['0002']);
});

test('entry type and Booth category combine without mutating source', () => {
  const before = structuredClone(data);
  assert.deepEqual(ids(filterCatalog(data, { entryTypeFilter: 'world' })), ['0003']);
  assert.deepEqual(ids(filterCatalog(data, { categories: ['Booth'], entryTypeFilter: 'avatar' })), ['0001']);
  assert.deepEqual(data, before);
});

test('latest mode keeps the same newest members in both sort directions', () => {
  const entries = Array.from({ length: 105 }, (_, i) => item(String(i + 1).padStart(4, '0'), '動物', '作者'));
  const asc = filterCatalog(entries, { latestCount: 100 }, true);
  const desc = filterCatalog(entries, { latestCount: 100 }, false);
  assert.equal(asc[0].id, '0006');
  assert.equal(desc[0].id, '0105');
  assert.deepEqual(ids(asc), ids(desc).reverse());
});

test('normal sorting retains public display-serial semantics', () => {
  const entries = [data[1], { ...data[2], displaySerial: '0001' }];
  assert.deepEqual(ids(filterCatalog(entries, {}, true)), ['0003', '0002']);
  assert.deepEqual(ids(filterCatalog(entries, {}, false)), ['0002', '0003']);
});

test('public favorites and random behavior remain available', () => {
  assert.deepEqual(ids(filterCatalog([{ ...data[0], isFavorite: true }, data[1]], { favoritesOnly: true })), ['0001']);
  assert.equal(filterCatalog(data, { randomCount: 2 }).length, 2);
});
