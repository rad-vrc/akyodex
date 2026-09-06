import assert from 'node:assert/strict';
import test from 'node:test';

import { hasAllCategories, stageCategoryUpdate, toggleCategories } from './category-assignment';
import type { AkyoData } from '@/types/akyo';

const akyo: AkyoData = {
  id: '0001', nickname: 'うまAkyo', avatarName: 'horse', author: 'a', creator: 'a',
  category: '動物,動物/うま', attribute: '動物,動物/うま', comment: '', notes: '', appearance: '',
  entryType: 'avatar', displaySerial: '0001',
  sourceUrl: 'https://vrchat.com/home/avatar/avtr_1', avatarUrl: 'https://vrchat.com/home/avatar/avtr_1',
};

test('hasAllCategories: AND over the selected set, never true for an empty set', () => {
  assert.equal(hasAllCategories(['動物', '動物/うま'], ['動物', '動物/うま']), true);
  assert.equal(hasAllCategories(['動物'], ['動物', '動物/うま']), false);
  assert.equal(hasAllCategories(['動物'], []), false);
});

test('toggleCategories: adds the missing tokens with ancestors, removes the set with descendants', () => {
  // Partial match → add what is missing (plus ancestors), keep the rest.
  assert.deepEqual(toggleCategories(['乗り物'], ['動物/うま', '次元']), ['乗り物', '動物', '動物/うま', '次元']);
  // Full match → remove the set and everything below it; unrelated tokens stay.
  assert.deepEqual(toggleCategories(['動物', '動物/うま', '動物/うま/ポニー', '乗り物'], ['動物/うま']), ['動物', '乗り物']);
  // Removing a parent removes its children, whether or not they are in the set.
  assert.deepEqual(toggleCategories(['動物', '動物/うま', '乗り物'], ['動物']), ['乗り物']);
  // Two selected, one deselected afterwards: only the remaining one is removed.
  const added = toggleCategories(['乗り物'], ['動物', '次元']);
  assert.deepEqual(added, ['乗り物', '動物', '次元']);
  assert.deepEqual(toggleCategories(added, ['次元']), ['乗り物', '動物']);
  assert.deepEqual(toggleCategories(['動物'], []), ['動物']);
});

test('stageCategoryUpdate: keeps the first original, drops a change that returns to it', () => {
  const staged = stageCategoryUpdate(akyo, undefined, ['動物', '動物/うま', '次元']);
  assert.ok(staged);
  assert.equal(staged.original.category, '動物,動物/うま');
  assert.equal(staged.changes.category, '動物,動物/うま,次元');
  assert.equal(staged.changes.id, '0001');
  const back = stageCategoryUpdate(akyo, staged, ['動物', '動物/うま']);
  assert.equal(back, null);
  // Ancestor-only differences are not changes (the CSV→JSON step inserts them anyway).
  assert.equal(stageCategoryUpdate(akyo, undefined, ['動物/うま']), null);
});
