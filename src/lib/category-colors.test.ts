import assert from 'node:assert/strict';
import test from 'node:test';

import { getCategoryColor } from './akyo-data-helpers';

test('fallback category colors avoid purple and yellow hues', () => {
  const categoriesByPaletteIndex = [
    '未定義0',
    '未定義4',
    '未定義3',
    '未定義2',
    '未定義1',
  ];

  assert.deepEqual(
    categoriesByPaletteIndex.map(getCategoryColor),
    ['#00acc1', '#43a047', '#795548', '#f5576c', '#1a73cc'],
  );
});

test('formerly purple semantic colors use established non-purple colors', () => {
  assert.equal(getCategoryColor('おばけ'), '#607d8b');
  assert.equal(getCategoryColor('ドラゴン'), '#d32f2f');
  assert.equal(getCategoryColor('ファンタジー'), '#00acc1');
});

test('food and fox categories use orange instead of mustard yellow', () => {
  assert.equal(getCategoryColor('食べ物'), '#d84315');
  assert.equal(getCategoryColor('きつね'), '#d84315');
});
