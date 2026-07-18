/**
 * Common Helper Functions for Akyo Data Processing
 * 
 * This module provides reusable utility functions for extracting
 * categories, authors, and finding items in Akyo datasets.
 * Used by akyo-data.ts, akyo-data-server.ts, akyo-data-json.ts, and akyo-data-kv.ts
 * to avoid code duplication.
 */

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
 * 低コントラストだった植物色も WCAG 1.4.3 準拠のために暗めに調整済み。
 */
const CATEGORY_COLOR_MAP: Record<string, string> = {
  チョコミント: '#00bfa5',
  動物: '#ff6f61',
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
 * 紫に偏らない、色名で区別しやすいシアン・緑・青灰・ピンク・青を使用する。
 */
const DEFAULT_COLORS = ['#00acc1', '#43a047', '#607d8b', '#f5576c', '#1a73cc'];

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
 * マッピングに一致するキーワードが含まれていればその色を返し、
 * 一致しなければカテゴリ名のハッシュからデフォルト色を決定的に選択する。
 * （Math.random() を使わないため SSR/CSR のハイドレーションミスマッチが起きない）
 *
 * @param category - カテゴリ文字列
 * @returns HEX カラーコード
 */
export function getCategoryColor(category: string): string {
  for (const [key, color] of Object.entries(CATEGORY_COLOR_MAP)) {
    if (category && category.includes(key)) {
      return color;
    }
  }
  return DEFAULT_COLORS[hashString(category || '') % DEFAULT_COLORS.length];
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

/**
 * 白背景 (#fff) 上のテキスト色として WCAG 1.4.3 のコントラスト比を満たす色を返す。
 *
 * カード/リストのバッジは `background: ${color}20`（≈白）の上に `color` をテキスト
 * として表示するため、実質的に白背景に対するコントラストが必要。
 * 元の色相・彩度を維持しつつ明度を下げてコントラスト比 ≥ minRatio を確保する。
 *
 * @param hexColor - HEX カラーコード (例: '#ff9800')
 * @param minRatio - 目標コントラスト比 (デフォルト: 4.5)
 * @returns コントラストが保証された HEX カラーコード
 */
export function ensureContrastOnWhite(hexColor: string, minRatio = 4.5): string {
  const cached = contrastOnWhiteCache.get(hexColor);
  if (cached) return cached;

  const whiteL = 1.0; // #ffffff の相対輝度
  const fgL = relativeLuminance(hexToRGB(hexColor));
  if (contrastRatio(whiteL, fgL) >= minRatio) {
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
    if (contrastRatio(whiteL, candidateL) >= minRatio) {
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
