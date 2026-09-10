import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureContrastForWhiteText,
  ensureContrastOnTintedWhite,
  getCategoryColor,
  getTintedBadgeBackground,
} from './akyo-data-helpers';
import categoryColors from './category-colors.json';

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
// 実データで最上位として生きている色＋キーワード表とフォールバックの代表元色。
// 登録側は管理画面の「色を変える」から書き換わるので、固定値ではなく JSON そのものを
// 読む。ここに書き写すと、色を変えるたびにこのテストが落ちる（実際に落ちた: 機械を
// #00acc1 にした 1204184 で main の CI が赤くなった）
const LIVE_BASE_COLORS = [...new Set([
  ...Object.values(categoryColors as Record<string, string>),
  // 以下は管理画面からは書けない。キーワード表とハッシュ 5 色の代表
  '#d44335', // 動物（キーワード表）
  '#d32f2f', // ドラゴン（キーワード表）
  '#00acc1', // fallback0
  '#43a047', // fallback1
  '#607d8b', // fallback2
  '#cc3466', // fallback3
  '#0379cc', // fallback4
])];

/**
 * 登録済みの色そのもの。どの色かは管理画面から変えられるので固定しない。
 * 守りたいのは「キーワード表やハッシュに落ちていないこと」で、色の値ではない
 */
const registered = (jaTopLevel: string) => {
  const color = (categoryColors as Record<string, string>)[jaTopLevel];
  assert.ok(color, `${jaTopLevel} が category-colors.json に登録されていない`);
  return color;
};

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
    ['#00acc1', '#43a047', '#607d8b', '#cc3466', '#0379cc'],
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
  // 正規化された JA 名で JSON を引く。キーワード表やハッシュには落ちない。
  // 色そのものは管理画面から変えられるので固定しない
  assert.equal(getCategoryColor('Mint Chocolate'), registered('チョコミント類'));
  assert.equal(getCategoryColor('Food'), registered('食べ物'));
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
  const DEFAULT_COLORS = ['#00acc1', '#43a047', '#607d8b', '#cc3466', '#0379cc'];
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const color = getCategoryColor(name);
    assert.ok(DEFAULT_COLORS.includes(color), `${name} → ${color} はフォールバック色であるべき`);
  }
});

test('Booth uses the WCAG-safe pink-red without triggering darkening', () => {
  // 白文字4.5:1を最初から満たす色を登録し、コントラスト補正(彩度維持の暗色化で
  // 信号赤になる)を発動させないことがこの色選定の要点。2026-09-10 に動物の赤橙と
  // 見分けるため色相をピンク寄り（23°→6°）へ動かした。
  assert.equal(getCategoryColor('Booth'), '#cc3466');
  assert.equal(getCategoryColor('Booth/アバター'), '#cc3466');
  assert.equal(ensureContrastForWhiteText(getCategoryColor('Booth')), '#cc3466');
});

// 元は動物が #d44335 単独だったが、実描画で食べ物の #d84315 と ΔE 14.5 しか離れておらず
// 見分けが付かないという判断で食べ物側に寄せた（2026-09-08、オーナー確認済み）。
// どちらの色を持つかは管理画面から変えられるので、ここでは色の性質だけを見る
test('the orange-red darkens only slightly for white text', () => {
  // #d44335 は補正が要らない色だったのに対し、#d84315 は #d34215 へ ΔE 2.0 だけ暗くなる
  assert.equal(ensureContrastForWhiteText('#d84315'), '#d34215');
});

test('formerly purple semantic colors use established non-purple colors', () => {
  assert.equal(getCategoryColor('おばけ'), '#607d8b');
  assert.equal(getCategoryColor('ドラゴン'), '#d32f2f');
  assert.equal(getCategoryColor('ファンタジー'), '#00acc1');
});

// きつねは JSON に無くキーワード表で解決する。管理画面からは書けないので固定してよい
test('the fox keyword uses orange instead of mustard yellow', () => {
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

/*
 * ここから下は「改名・分離・翻訳を経ても、登録済みの色そのものに解決されること」を見る。
 * どの色かは固定しない。管理画面の「色を変える」（PR #550）で最上位カテゴリの色は
 * いつでも書き換わるので、色を書き写すとその操作のたびにテストが落ちる。実際に落ちた:
 * 機械を #00acc1 にした 1204184 で main の CI が赤くなった。
 *
 * 守りたいのは「キーワード表やハッシュに落ちていないこと」。旧実装ではそこが崩れると、
 * 同じ Akyo のカテゴリが言語ごとに違う色になって現れた。
 *
 * これまでの色の判断（記録として残す。アサーションにはしない）:
 * - 芸術は「芸術・アート」から階層化しても青灰を維持
 * - 作風・スタイルは廃止した「電子」の落ち着いた赤を引き継ぐ
 * - グッズはフォールバックの緑ではなくシアン
 * - 緑系は実描画で 124°/141°/178° の 3 色あり、赤系 2・青系 2 に対して 1 つ多かった。
 *   一度は 141° の緑を 124° のオリーブ #5a8a1a に寄せたが、オリーブは自然単体には
 *   合っていても緑を共有する 8 カテゴリ全体には合わないという判断で逆向きに統合した
 * - レアの語感は本来は黄色だが、チップは補正後 L≈49 に明度が固定されるので、その明度の
 *   黄色帯（60〜105°）は上限彩度 55〜67 の茶／オリーブにしかならず黄色に見えない
 */
test('renamed, split and translated hierarchies resolve to their registered color', () => {
  const hierarchies: Array<[string, ...string[]]> = [
    ['芸術', '芸術/絵画・イラスト', 'Art', 'Art/Painting・Illustration', '예술', '예술/회화・일러스트'],
    ['作風・スタイル', '作風・スタイル/サイバーチック', 'Style', 'Style/Cyber', '스타일', '스타일/사이버풍'],
    ['ファッション・装備', 'ファッション・装備/武器', 'Fashion・Equipment', 'Fashion・Equipment/Weapon', '패션・장비', '패션・장비/무기'],
    ['機械', 'Machine', '기계'],
    ['自然', '自然/植物', '自然/植物/苔', 'Nature', 'Nature/Plant', '자연', '자연/식물'],
    ['グッズ', 'グッズ/揺れ物', 'Goods', 'Goods/Dangling Accessory', '굿즈', '굿즈/흔들리는 액세서리'],
    ['動物', '動物/きつね', 'Animal', '동물'],
    ['食べ物', 'Food', 'Food/Dish', '음식'],
  ];

  for (const [jaTopLevel, ...aliases] of hierarchies) {
    const expected = registered(jaTopLevel);
    assert.equal(getCategoryColor(jaTopLevel), expected, jaTopLevel);
    for (const alias of aliases) {
      assert.equal(getCategoryColor(alias), expected, `${alias} は ${jaTopLevel} と同じ色であるべき`);
    }
  }
});

// 上の表は代表例しか並べていない。対訳辞書が JA 名を別の名前へ正規化してしまうと
// JSON 引きが外れるので、登録済みの全カテゴリで引き直す
test('every registered category resolves to its own registered color', () => {
  for (const [name, color] of Object.entries(categoryColors as Record<string, string>)) {
    assert.equal(getCategoryColor(name), color, name);
  }
});
