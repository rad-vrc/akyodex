import assert from 'node:assert/strict';
import test from 'node:test';

import { groupCategoriesByParent, parseAndSortCategories } from './akyo-data-helpers';

test('groupCategoriesByParent: 親名の繰り返しを外して最上位ごとにまとめる', () => {
  const groups = groupCategoriesByParent(
    parseAndSortCategories('動物,動物/うま,動物/両生類,次元,乗り物,乗り物/陸上'),
  );
  assert.deepEqual(groups, [
    { parent: '乗り物', children: ['陸上'] },
    { parent: '動物', children: ['うま', '両生類'] },
    { parent: '次元', children: [] },
  ]);
});

test('groupCategoriesByParent: 3 階層は中間を落として末端のパスだけ残す', () => {
  const groups = groupCategoriesByParent(
    parseAndSortCategories('食べ物,食べ物/野菜,食べ物/野菜/ナス,食べ物/野菜/ねぎ,食べ物/料理'),
  );
  // parseAndSortCategories は文字コード順（ひらがな < カタカナ）
  assert.deepEqual(groups, [{ parent: '食べ物', children: ['料理', '野菜/ねぎ', '野菜/ナス'] }]);
});

test('groupCategoriesByParent: 親が欠けた子だけのデータでも親グループを作る', () => {
  assert.deepEqual(groupCategoriesByParent(['動物/うま']), [{ parent: '動物', children: ['うま'] }]);
  assert.deepEqual(groupCategoriesByParent([]), []);
});

test('groupCategoriesByParent: 「・」を含むカテゴリ名を分割しない', () => {
  const groups = groupCategoriesByParent(parseAndSortCategories('季節・行事,季節・行事/お正月,身分・役割'));
  assert.deepEqual(groups, [
    { parent: '季節・行事', children: ['お正月'] },
    { parent: '身分・役割', children: [] },
  ]);
});
