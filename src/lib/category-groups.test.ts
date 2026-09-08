import assert from 'node:assert/strict';
import test from 'node:test';

import {
  categoriesForFilterPanel,
  compareCategories,
  groupCategoriesByParent,
  parseAndSortCategories,
} from './akyo-data-helpers';

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

// ── 対応機種の固定 ───────────────────────────────────────────────────

test('compareCategories: 対応機種だけをすべてに優先して先頭へ出す', () => {
  // ひらがな < カタカナ < 漢字 の文字コード順なら「対応機種」は最後の方に来る
  const sorted = ['まめ', 'チョコミント類', '動物', '対応機種', 'Booth'].sort(compareCategories);
  assert.deepEqual(sorted, ['対応機種', 'Booth', 'まめ', 'チョコミント類', '動物']);
});

test('compareCategories: EN/KO のカテゴリ名でも先頭に固定する', () => {
  // 対訳辞書（category-canonical.json）でJA正規名へ寄せてから判定する
  assert.deepEqual(
    ['Animal', 'Supported Platform', 'Booth'].sort(compareCategories),
    ['Supported Platform', 'Animal', 'Booth'],
  );
  assert.deepEqual(
    ['동물', '지원 기기', 'Booth'].sort(compareCategories),
    ['지원 기기', 'Booth', '동물'],
  );
});

test('compareCategories: 対応機種以外の並びは既定のソートと変わらない', () => {
  const others = ['まめ', 'チョコミント類', '動物', 'Booth', '食べ物/野菜', '食べ物'];
  assert.deepEqual([...others].sort(compareCategories), [...others].sort());
});

test('compareCategories: 対応機種の配下は親のすぐ後ろに文字コード順で並ぶ', () => {
  assert.deepEqual(
    ['対応機種/iOS', '動物', '対応機種', '対応機種/Quest(Android)', '対応機種/PC'].sort(
      compareCategories,
    ),
    ['対応機種', '対応機種/PC', '対応機種/Quest(Android)', '対応機種/iOS', '動物'],
  );
});

test('compareCategories: 入力の順序によらず同じ結果になる（全順序であること）', () => {
  const input = ['動物', '対応機種/PC', 'まめ', '対応機種', 'Booth', '対応機種/iOS'];
  const expected = [...input].sort(compareCategories);
  // 逆順・回転から始めても同じ並びに落ち着く
  assert.deepEqual([...input].reverse().sort(compareCategories), expected);
  assert.deepEqual([...input.slice(3), ...input.slice(0, 3)].sort(compareCategories), expected);
});

test('parseAndSortCategories: カードのバッジでも対応機種が先頭のグループになる', () => {
  const groups = groupCategoriesByParent(
    parseAndSortCategories('動物,動物/きつね,対応機種,対応機種/PC,対応機種/Quest(Android),Booth'),
  );
  assert.deepEqual(groups, [
    { parent: '対応機種', children: ['PC', 'Quest(Android)'] },
    { parent: 'Booth', children: [] },
    { parent: '動物', children: ['きつね'] },
  ]);
});

test('parseAndSortCategories: 対応機種を持たない行は従来どおりの並び', () => {
  assert.deepEqual(parseAndSortCategories('動物,まめ,Booth'), ['Booth', 'まめ', '動物']);
});

test('categoriesForFilterPanel: 絞り込みに使えない対応機種（親単体）だけを外す', () => {
  // 対応機種は判定できた全行に付くので、押しても件数がほぼ変わらない
  assert.deepEqual(
    categoriesForFilterPanel([
      '対応機種',
      '対応機種/PC',
      '対応機種/Quest(Android)',
      '対応機種/iOS',
      'Booth',
      'Booth/アバター',
      '動物',
    ]),
    ['対応機種/PC', '対応機種/Quest(Android)', '対応機種/iOS', 'Booth', 'Booth/アバター', '動物'],
  );
});

test('categoriesForFilterPanel: EN/KO の親単体も外す', () => {
  assert.deepEqual(
    categoriesForFilterPanel(['Supported Platform', 'Supported Platform/PC', 'Animal']),
    ['Supported Platform/PC', 'Animal'],
  );
  assert.deepEqual(categoriesForFilterPanel(['지원 기기', '지원 기기/iOS', '동물']), [
    '지원 기기/iOS',
    '동물',
  ]);
});

test('categoriesForFilterPanel: 実際に絞り込める親カテゴリは残す', () => {
  // Booth は 949 行中 191 行なので絞り込みとして機能する。常に子を持つかどうかは
  // 判定基準ではない（Booth も形状・触り心地も常に子を持つ）。
  const others = ['Booth', '形状・触り心地', '自然', '技能・特性', '動物', 'まめ'];
  assert.deepEqual(categoriesForFilterPanel(others), others);
});
