/**
 * Common Helper Functions for Akyo Data Processing
 * 
 * This module provides reusable utility functions for extracting
 * categories, authors, and finding items in Akyo datasets.
 * Used by akyo-data.ts, akyo-data-server.ts, akyo-data-json.ts, and akyo-data-kv.ts
 * to avoid code duplication.
 */

import categoryCanonical from '@/lib/category-canonical.json';
import type { AkyoData } from '@/types/akyo';
/**
 * Delimiter pattern for splitting multi-value strings in CSV (comma or Japanese ideographic comma)
 */
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;

/**
 * Extract all unique categories from a dataset
 * Handles both 'category' and legacy 'attribute' fields
 * Supports both Japanese (、) and Western (,) delimiters
 * 
 * @param data - Array of Akyo data
 * @returns Sorted array of unique categories
 */
export function extractCategories(data: AkyoData[]): string[] {
  const categoriesSet = new Set<string>();

  data.forEach((akyo) => {
    const catStr = akyo.category || akyo.attribute || '';
    const cats = catStr.split(MULTI_VALUE_SPLIT_PATTERN).map((c) => c.trim()).filter(Boolean);
    cats.forEach((cat) => categoriesSet.add(cat));
  });

  return Array.from(categoriesSet).sort();
}

/**
 * Extract all unique authors from a dataset
 * Handles both 'author' and legacy 'creator' fields
 * Supports both Japanese (、) and Western (,) delimiters
 * 
 * @param data - Array of Akyo data
 * @returns Sorted array of unique authors
 */
export function extractAuthors(data: AkyoData[]): string[] {
  const authorsSet = new Set<string>();

  data.forEach((akyo) => {
    const authorStr = akyo.author || akyo.creator || '';
    const authors = authorStr
      .split(MULTI_VALUE_SPLIT_PATTERN)
      .map((a) => a.trim())
      .filter(Boolean);
    authors.forEach((author) => authorsSet.add(author));
  });

  return Array.from(authorsSet).sort();
}

/**
 * Parse category string and sort with the same logic as filter panel
 * (default JavaScript lexical sort).
 * 
 * @param category - Raw category string from data
 * @returns Sorted array of trimmed category strings
 */
export function parseAndSortCategories(category: string): string[] {
  return category
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Find a single Akyo item by ID
 * 
 * @param data - Array of Akyo data
 * @param id - 4-digit ID (e.g., "0001")
 * @returns Single Akyo data or null if not found
 */
export function findAkyoById(data: AkyoData[], id: string): AkyoData | null {
  return data.find((akyo) => akyo.id === id) || null;
}

/**
 * カテゴリ名 → 色の定数マッピング
 *
 * 黄色系は白背景で黄土色に見えるため、食べ物・きつねを深いオレンジに調整済み。
 * 低コントラストだった自然色も WCAG 1.4.3 準拠のために暗めに調整済み。
 */
const CATEGORY_COLOR_MAP: Record<string, string> = {
  チョコミント: '#00bfa5',
  // Boothと同じ設計: 旧#ff6f61は白文字コントラスト補正（彩度維持の暗色化）で
  // #eb1500の信号赤として表示されていた。補正を発動させない白文字4.51:1準拠の
  // 落ち着いた赤（彩度65%相当）を最初から登録する。
  動物: '#d44335',
  きつね: '#d84315',
  おばけ: '#607d8b',
  人類: '#2196f3',
  ギミック: '#4caf50',
  特殊: '#e91e63',
  ネコ: '#795548',
  イヌ: '#607d8b',
  うさぎ: '#ff4081',
  ドラゴン: '#d32f2f',
  ロボット: '#757575',
  食べ物: '#d84315',
  // BOOTH公式は#fc4d50(実測)だが、白文字コントラスト補正(彩度維持で暗色化)を
  // 通すと#ee0408の信号赤になる。補正を発動させないよう、色相を保ち彩度を
  // 65%へ落とした白文字4.5:1準拠色を最初から登録する。
  Booth: '#d63d43',
  グッズ: '#00acc1',
  Goods: '#00acc1',
  굿즈: '#00acc1',
  自然: '#5a8a1a',
  Nature: '#5a8a1a',
  자연: '#5a8a1a',
  // 「芸術・アート」から階層化しても既存の青灰色を維持する。
  芸術: '#607d8b',
  // 廃止した「電子」の落ち着いた赤を、後継の作風カテゴリへ引き継ぐ。
  '作風・スタイル': '#d63d43',
  // 既存カテゴリの改名・分離後も一覧で急に色が変わらないよう維持する。
  'ファッション・装備': '#1a73cc',
  機械: '#43a047',
  植物: '#5a8a1a',
  宇宙: '#3f51b5',
  和風: '#d32f2f',
  洋風: '#1976d2',
  ファンタジー: '#00acc1',
  SF: '#00acc1',
  ホラー: '#424242',
  かわいい: '#ec407a',
  クール: '#5c6bc0',
  シンプル: '#78909c',
};

/**
 * デフォルト色（カテゴリマッピングに該当しない場合に使用）
 *
 * 紫に偏らない、色名で区別しやすいシアン・緑・青灰・赤・青を使用する。
 * 赤は旧#f5576cが白文字補正で#ec0e2c(信号赤)化していたため、補正を発動させない
 * 白文字4.5:1準拠のセミブライト赤#d63d43に変更(2026-08-31)。
 */
const DEFAULT_COLORS = ['#00acc1', '#43a047', '#607d8b', '#d63d43', '#1a73cc'];

/**
 * Generates a deterministic hash value from a string (simple djb2 algorithm).
 * Used instead of Math.random() to ensure consistent UI state (like colors)
 * between SSR and CSR, preventing hydration mismatches.
 *
 * @param str - The string to hash
 * @returns A non-negative 32-bit integer
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0; // 32bit整数に変換
  }
  return Math.abs(hash);
}

/**
 * カテゴリ名に対応する色を取得
 *
 * 最上位カテゴリのマッピングに一致するキーワードが含まれていればその色を返し、
 * 一致しなければ最上位カテゴリ名のハッシュからデフォルト色を決定的に選択する。
 * 下位カテゴリは階層の深さにかかわらず最上位カテゴリの色を継承する。
 * （Math.random() を使わないため SSR/CSR のハイドレーションミスマッチが起きない）
 *
 * @param category - カテゴリ文字列
 * @returns HEX カラーコード
 */
export function getCategoryColor(category: string): string {
  const rawTopLevel = (category || '').split('/', 1)[0].trim();
  // EN/KOのカテゴリ名をJA正規名へ変換してから色を決める。これをしないと
  // ハッシュフォールバックが言語ごとに別の色へ散り、同じAkyoのカテゴリが
  // 言語によって違う色になる（対訳辞書はデータ同期で自動再生成される）。
  // Object.hasOwn必須: 素の添字参照だと "constructor" や "toString" という
  // カテゴリ名でprototype上の関数が返り、後段のincludesで例外になる。
  const canonicalName = Object.hasOwn(categoryCanonical, rawTopLevel)
    ? (categoryCanonical as Record<string, string>)[rawTopLevel]
    : undefined;
  const topLevelCategory = canonicalName ?? rawTopLevel;

  for (const [key, color] of Object.entries(CATEGORY_COLOR_MAP)) {
    if (topLevelCategory.includes(key)) {
      return color;
    }
  }
  return DEFAULT_COLORS[hashString(topLevelCategory) % DEFAULT_COLORS.length];
}

// ---------------------------------------------------------------------------
// WCAG 1.4.3 コントラスト比ユーティリティ
// ---------------------------------------------------------------------------

/** HEX (#rrggbb) → { r, g, b } (0–255) */
function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

/** { r, g, b } → #rrggbb */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** sRGB 相対輝度 (WCAG 2.1 定義) */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** 2色間のコントラスト比 (1–21) */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** HEX → HSL (h: 0–360, s: 0–1, l: 0–1) */
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const { r: r8, g: g8, b: b8 } = hexToRGB(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

/** HSL → HEX */
function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbToHex(v, v, v);
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;
  return rgbToHex(
    Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hNorm) * 255),
    Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255),
  );
}

// メモ化キャッシュ（SSR/CSR 両方で動作、色数は有限なので Map で十分）
const contrastOnWhiteCache = new Map<string, string>();
const contrastForWhiteTextCache = new Map<string, string>();

/** `${color}20`（alpha 0x20/255 ≈ 12.5%）を白に重ねたバッジ薄底の実背景色 */
function tintedWhiteBackground(hexColor: string): { r: number; g: number; b: number } {
  const alpha = 0x20 / 255;
  const { r, g, b } = hexToRGB(hexColor);
  return {
    r: alpha * r + (1 - alpha) * 255,
    g: alpha * g + (1 - alpha) * 255,
    b: alpha * b + (1 - alpha) * 255,
  };
}

const tintedBadgeBackgroundCache = new Map<string, string>();

/**
 * バッジ薄底の背景色を「白へ事前合成した不透明HEX」として返す。
 *
 * 旧実装の半透明 `${color}20` は下地に依存して最終色が変わるため、
 * リスト行ホバー（#f9fafb）等で ensureContrastOnTintedWhite の白合成基準と
 * ずれ、文字コントラストが4.5:1を割れていた。不透明化すれば下地が
 * 何色でもバッジの実背景はこの値で固定され、コントラスト保証が崩れない。
 */
export function getTintedBadgeBackground(hexColor: string): string {
  const cached = tintedBadgeBackgroundCache.get(hexColor);
  if (cached) return cached;
  const { r, g, b } = tintedWhiteBackground(hexColor);
  const result = rgbToHex(r, g, b);
  tintedBadgeBackgroundCache.set(hexColor, result);
  return result;
}

/**
 * カード/リストのバッジ（`background: ${color}20` の薄底）上のテキスト色として、
 * WCAG 1.4.3 のコントラスト比を満たす色を返す。
 *
 * 旧実装は基準を白(#fff)で近似していたが、薄底は色が乗るぶん白より暗く、
 * 「白基準で4.5ちょうど」の色が実背景では3.7〜4.0台に割れていた。
 * 実際の合成後背景の輝度を基準に、元の色相・彩度を維持しつつ明度を下げて
 * コントラスト比 ≥ minRatio を確保する。
 *
 * @param hexColor - HEX カラーコード (例: '#ff9800')
 * @param minRatio - 目標コントラスト比 (デフォルト: 4.5)
 * @returns コントラストが保証された HEX カラーコード
 */
export function ensureContrastOnTintedWhite(hexColor: string, minRatio = 4.5): string {
  const cached = contrastOnWhiteCache.get(hexColor);
  if (cached) return cached;

  // バッジ背景は元色の12.5%薄底で固定（文字色を暗くしても背景は変わらない）
  const bgL = relativeLuminance(tintedWhiteBackground(hexColor));
  const fgL = relativeLuminance(hexToRGB(hexColor));
  if (contrastRatio(bgL, fgL) >= minRatio) {
    contrastOnWhiteCache.set(hexColor, hexColor);
    return hexColor;
  }

  // HSL の L を段階的に下げてコントラスト比を確保
  const { h, s, l } = hexToHSL(hexColor);
  let newL = l;
  const step = 0.01;
  while (newL > 0) {
    newL = Math.max(0, newL - step);
    const candidate = hslToHex(h, s, newL);
    const candidateL = relativeLuminance(hexToRGB(candidate));
    if (contrastRatio(bgL, candidateL) >= minRatio) {
      contrastOnWhiteCache.set(hexColor, candidate);
      return candidate;
    }
  }

  // 極端なケース：黒を返す
  const fallback = '#000000';
  contrastOnWhiteCache.set(hexColor, fallback);
  return fallback;
}

/**
 * 白テキスト (#fff) に対して WCAG 1.4.3 のコントラスト比を満たす背景色を返す。
 *
 * モーダルのカテゴリバッジは白テキストをソリッドカラー背景上に表示するため、
 * 背景色を十分に暗くする必要がある。
 * 元の色相・彩度を維持しつつ明度を下げてコントラスト比 ≥ minRatio を確保する。
 *
 * @param hexColor - HEX カラーコード (例: '#ffc107')
 * @param minRatio - 目標コントラスト比 (デフォルト: 4.5)
 * @returns コントラストが保証された HEX 背景色
 */
export function ensureContrastForWhiteText(hexColor: string, minRatio = 4.5): string {
  const cached = contrastForWhiteTextCache.get(hexColor);
  if (cached) return cached;

  const whiteL = 1.0;
  const bgL = relativeLuminance(hexToRGB(hexColor));
  if (contrastRatio(whiteL, bgL) >= minRatio) {
    contrastForWhiteTextCache.set(hexColor, hexColor);
    return hexColor;
  }

  const { h, s, l } = hexToHSL(hexColor);
  let newL = l;
  const step = 0.01;
  while (newL > 0) {
    newL = Math.max(0, newL - step);
    const candidate = hslToHex(h, s, newL);
    const candidateL = relativeLuminance(hexToRGB(candidate));
    if (contrastRatio(whiteL, candidateL) >= minRatio) {
      contrastForWhiteTextCache.set(hexColor, candidate);
      return candidate;
    }
  }

  const fallback = '#000000';
  contrastForWhiteTextCache.set(hexColor, fallback);
  return fallback;
}
