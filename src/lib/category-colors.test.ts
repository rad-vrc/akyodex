import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureContrastForWhiteText,
  ensureContrastOnTintedWhite,
  getCategoryColor,
  getTintedBadgeBackground,
} from './akyo-data-helpers';

// --- 実描画条件のコントラスト検証用ヘルパー（WCAG 2.x 定義の再実装） ---
const hexToRgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
const relLum = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};
const contrast = (l1: number, l2: number) =>
  (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
/** `${color}20` を白へ合成したバッジ薄底の実背景 */
const tint20 = (hex: string) => {
  const a = 0x20 / 255;
  const { r, g, b } = hexToRgb(hex);
  return { r: a * r + (1 - a) * 255, g: a * g + (1 - a) * 255, b: a * b + (1 - a) * 255 };
};
// 実データで最上位として生きているマップキー＋フォールバック5色の代表元色
const LIVE_BASE_COLORS = [
  '#00bfa5', // チョコミント
  '#d44335', // 動物
  '#4caf50', // ギミック
  '#d84315', // 食べ物
  '#d63d43', // Booth
  '#00acc1', // グッズ / fallback0
  '#5a8a1a', // 自然
  '#43a047', // fallback1
  '#607d8b', // fallback2
  '#1a73cc', // fallback4
];

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

test('chip colors meet WCAG 4.5:1 in their actual rendering contexts', () => {
  // 「不透明色 vs 白」だけの検証では、モーダルの旧半透明グラデ末端や
  // カードの薄底で3.6〜4.0台に割れる問題を検出できなかった（Codex指摘）。
  // モーダル=単色ベタ塗り+白文字 / カード・リスト=薄底(color20)+補正文字色、
  // の実描画条件で全代表色を検証する。
  for (const base of LIVE_BASE_COLORS) {
    // モーダル: ensureContrastForWhiteText の出力が白文字と4.5+（背景は単色化済み）
    const modalBg = ensureContrastForWhiteText(base);
    const modalRatio = contrast(1.0, relLum(hexToRgb(modalBg)));
    assert.ok(
      modalRatio >= 4.5,
      `modal chip ${base}→${modalBg}: ${modalRatio.toFixed(2)} < 4.5`,
    );

    // カード/リスト: バッジ背景は白へ事前合成した「不透明HEX」であること。
    // 半透明のままだとリスト行ホバー(#f9fafb)等の下地で最終色が変わり、
    // 白合成基準の文字コントラストがホバー中に4.5を割れる（Codex指摘）。
    const badgeBg = getTintedBadgeBackground(base);
    assert.match(badgeBg, /^#[0-9a-f]{6}$/, `badge bg ${badgeBg} must be opaque hex`);
    const expected = tint20(base);
    const actual = hexToRgb(badgeBg);
    assert.ok(
      Math.abs(actual.r - expected.r) <= 1 &&
        Math.abs(actual.g - expected.g) <= 1 &&
        Math.abs(actual.b - expected.b) <= 1,
      `badge bg ${badgeBg} should equal color20-over-white composite`,
    );

    // 文字色は不透明化された実背景と4.5+（背景が固定なので行ホバーでも不変）
    const badgeText = ensureContrastOnTintedWhite(base);
    const badgeRatio = contrast(relLum(hexToRgb(badgeText)), relLum(actual));
    assert.ok(
      badgeRatio >= 4.5,
      `badge text ${base}→${badgeText}: ${badgeRatio.toFixed(2)} < 4.5 on opaque tinted bg`,
    );
  }
});

test('prototype property names as categories fall back to hash colors without throwing', () => {
  // 素の添字参照だとObject.prototype上の関数が返りincludesで例外になる回帰の防止。
  // カテゴリは管理画面から自由に追加できるため、この名前群でも描画を壊さないこと。
  const DEFAULT_COLORS = ['#00acc1', '#43a047', '#607d8b', '#d63d43', '#1a73cc'];
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const color = getCategoryColor(name);
    assert.ok(DEFAULT_COLORS.includes(color), `${name} → ${color} はフォールバック色であるべき`);
  }
});

test('Booth uses the WCAG-safe semi-bright red without triggering darkening', () => {
  // 白文字4.5:1を最初から満たす色を登録し、コントラスト補正(彩度維持の暗色化で
  // #ee0408級の信号赤になる)を発動させないことがこの色選定の要点。
  assert.equal(getCategoryColor('Booth'), '#d63d43');
  assert.equal(getCategoryColor('Booth/アバター'), '#d63d43');
  assert.equal(ensureContrastForWhiteText(getCategoryColor('Booth')), '#d63d43');
});

test('Animal uses the WCAG-safe warm red without triggering darkening', () => {
  // Boothと同じ設計。旧#ff6f61は補正で#eb1500(信号赤)化していた。
  assert.equal(getCategoryColor('動物'), '#d44335');
  assert.equal(getCategoryColor('動物/きつね'), '#d44335');
  assert.equal(getCategoryColor('Animal'), '#d44335');
  assert.equal(getCategoryColor('동물'), '#d44335');
  assert.equal(ensureContrastForWhiteText(getCategoryColor('動物')), '#d44335');
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
    ['芸術', '芸術/絵画・イラスト', '芸術/工芸品', '芸術/彫刻・像'],
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

test('the renamed Art hierarchy preserves its established slate color', () => {
  for (const category of [
    '芸術',
    '芸術/絵画・イラスト',
    'Art',
    'Art/Painting・Illustration',
    '예술',
    '예술/회화・일러스트',
  ]) {
    assert.equal(getCategoryColor(category), '#607d8b');
  }
});

test('Cyber style inherits the established Electronic red in every language', () => {
  for (const category of [
    '作風・スタイル',
    '作風・スタイル/サイバーチック',
    'Style',
    'Style/Cyber',
    '스타일',
    '스타일/사이버풍',
  ]) {
    assert.equal(getCategoryColor(category), '#d63d43');
  }
});

test('renamed equipment and split machine categories preserve their established colors', () => {
  for (const category of [
    'ファッション・装備',
    'ファッション・装備/武器',
    'Fashion・Equipment',
    'Fashion・Equipment/Weapon',
    '패션・장비',
    '패션・장비/무기',
  ]) {
    assert.equal(getCategoryColor(category), '#1a73cc');
  }
  for (const category of ['機械', 'Machine', '기계']) {
    assert.equal(getCategoryColor(category), '#43a047');
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
