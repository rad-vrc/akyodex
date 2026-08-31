import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureContrastForWhiteText, getCategoryColor } from './akyo-data-helpers';

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
    ['#00acc1', '#43a047', '#607d8b', '#d63d43', '#1a73cc'],
  );
});

test('translated categories resolve to the same color as their Japanese counterpart', () => {
  // EN/KOはビルド時生成の対訳辞書(category-canonical.json)でJA名へ正規化される。
  // これが無いとハッシュフォールバックが言語ごとに別色へ散る。
  const trios: Array<[string, string, string]> = [
    ['動物', 'Animal', '동물'],
    ['パロディ', 'Parody', '패러디'],
    ['チョコミント類', 'Mint Chocolate', '초코민트류'],
    ['食べ物', 'Food', '음식'],
    ['ワールド', 'World', '월드'],
  ];
  for (const [jaName, enName, koName] of trios) {
    const jaColor = getCategoryColor(jaName);
    assert.equal(getCategoryColor(enName), jaColor, `${enName} != ${jaName}`);
    assert.equal(getCategoryColor(koName), jaColor, `${koName} != ${jaName}`);
  }
  // マップ命中系はマップ色そのものになる
  assert.equal(getCategoryColor('Mint Chocolate'), '#00bfa5');
  assert.equal(getCategoryColor('Food'), '#d84315');
});

test('Booth uses the WCAG-safe semi-bright red without triggering darkening', () => {
  // 白文字4.5:1を最初から満たす色を登録し、コントラスト補正(彩度維持の暗色化で
  // #ee0408級の信号赤になる)を発動させないことがこの色選定の要点。
  assert.equal(getCategoryColor('Booth'), '#d63d43');
  assert.equal(getCategoryColor('Booth/アバター'), '#d63d43');
  assert.equal(ensureContrastForWhiteText(getCategoryColor('Booth')), '#d63d43');
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

test('nested categories inherit the top-level category color', () => {
  const categoryHierarchies = [
    ['器官', '器官/耳'],
    ['芸術・アート', '芸術・アート/絵画'],
    ['Food', 'Food/Dish', 'Food/Dish/Fried'],
    ['동물', '동물/여우'],
  ];

  for (const [topLevelCategory, ...nestedCategories] of categoryHierarchies) {
    const topLevelColor = getCategoryColor(topLevelCategory);
    for (const category of nestedCategories) {
      assert.equal(getCategoryColor(category), topLevelColor);
    }
  }
});

test('Nature and its translated hierarchies retain the established plant green', () => {
  const natureCategories = [
    '自然',
    '自然/植物',
    '自然/植物/苔',
    'Nature',
    'Nature/Plant',
    '자연',
    '자연/식물',
  ];

  for (const category of natureCategories) {
    assert.equal(getCategoryColor(category), '#5a8a1a');
  }
});

test('goods and its translated hierarchies use cyan instead of fallback green', () => {
  const goodsCategories = [
    'グッズ',
    'グッズ/揺れ物',
    'Goods',
    'Goods/Dangling Accessory',
    '굿즈',
    '굿즈/흔들리는 액세서리',
  ];

  for (const category of goodsCategories) {
    assert.equal(getCategoryColor(category), '#00acc1');
  }
});
