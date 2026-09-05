/**
 * Category management operations (pure, no I/O).
 *
 * A category is a `/`-separated path used as a token in the JA CSV `Category` column
 * (`動物`, `動物/うま`). Rows list every ancestor of a token they carry. Translations live in
 * `data/category-translations.json` keyed by the JA path; top-level colors in
 * `src/lib/category-colors.json` keyed by the top-level JA name.
 *
 * Every operation is one primitive: replace path `A` (and every `A/...` below it) with `B`
 * in all three files. Rename, move, merge and delete are that primitive with different
 * validation and a different target. EN/KO CSVs are not touched here: the
 * `Sync JSON Data from CSV` workflow regenerates them from the JA CSV and the translations.
 */

import { getCategoryColor } from './akyo-data-helpers';
import { WORLD_CATEGORY_MARKERS } from './akyo-entry';

export const CATEGORY_LANGUAGES = ['en', 'ko'] as const;
export type CategoryLanguage = (typeof CATEGORY_LANGUAGES)[number];
export type CategoryTranslation = Record<CategoryLanguage, string>;
export type CategoryTranslations = Record<string, CategoryTranslation>;
export type CategoryColors = Record<string, string>;

export interface CategoryDataset {
  header: string[];
  records: string[][];
  translations: CategoryTranslations;
  colors: CategoryColors;
}

export interface CategoryChange {
  dataset: CategoryDataset;
  /** Rows whose Category cell changed */
  changedRows: number;
  /** Commit message */
  message: string;
}

export interface CategorySummary {
  path: string;
  en: string | null;
  ko: string | null;
  /** Rows carrying this token or a descendant of it */
  count: number;
}

export class CategoryOperationError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'CategoryOperationError';
    this.status = status;
  }
}

const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;
/** Categories the app adds or reads by name; renaming them would break world/Booth handling. */
const PROTECTED_TOP_LEVEL = new Set(['booth', ...WORLD_CATEGORY_MARKERS]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function splitCategoryCell(value: string): string[] {
  return String(value || '')
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function topLevelOf(path: string): string {
  return path.split('/', 1)[0];
}

export function parentOf(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index < 0 ? null : path.slice(0, index);
}

function isSelfOrDescendant(token: string, path: string): boolean {
  return token === path || token.startsWith(`${path}/`);
}

function replacePathPrefix(token: string, from: string, to: string): string {
  return token === from ? to : `${to}${token.slice(from.length)}`;
}

function isProtected(path: string): boolean {
  return PROTECTED_TOP_LEVEL.has(topLevelOf(path).toLowerCase());
}

/** Insert missing ancestors in front of each token and drop duplicates, keeping order. */
export function withAncestors(tokens: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const parts = token.split('/');
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const ancestor = parts.slice(0, depth).join('/');
      if (!seen.has(ancestor)) {
        seen.add(ancestor);
        result.push(ancestor);
      }
    }
  }
  return result;
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

/**
 * A valid category path: non-empty trimmed segments joined by `/`, no separators the CSV
 * or the UI use (`,` `、`), no formula-injection prefix.
 */
export function validateCategoryPath(value: unknown, label: string = 'カテゴリ名'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CategoryOperationError(`${label}を入力してください`);
  }
  if (value !== value.trim()) {
    throw new CategoryOperationError(`${label}の前後に空白は使えません`);
  }
  if (/[,、]/.test(value)) {
    throw new CategoryOperationError(`${label}に「,」「、」は使えません`);
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment.trim() === '' || segment !== segment.trim()) {
      throw new CategoryOperationError(`${label}の「/」の前後に空白や空の階層は置けません`);
    }
    if (/^[=+\-@\t]/.test(segment)) {
      throw new CategoryOperationError(`${label}の各階層は「=」「+」「-」「@」で始められません`);
    }
    // Assigning obj['__proto__'] replaces the prototype instead of adding a key, so this one
    // name could never be stored in the translation table.
    if (segment === '__proto__') {
      throw new CategoryOperationError(`${label}に「__proto__」は使えません`);
    }
  }
  return value;
}

export function validateTranslationLeaf(value: unknown, language: CategoryLanguage): string {
  const labels: Record<CategoryLanguage, string> = { en: '英語名', ko: '韓国語名' };
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CategoryOperationError(`${labels[language]}を入力してください`);
  }
  if (value !== value.trim()) {
    throw new CategoryOperationError(`${labels[language]}の前後に空白は使えません`);
  }
  if (/[,、/]/.test(value)) {
    throw new CategoryOperationError(`${labels[language]}に「,」「、」「/」は使えません（親の名前は自動で付きます）`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Dataset queries
// ---------------------------------------------------------------------------

function categoryColumnIndex(dataset: CategoryDataset): number {
  const index = dataset.header.indexOf('Category');
  if (index < 0) throw new CategoryOperationError('CSV に Category 列がありません', 500);
  return index;
}

/** Every path known to the data: tokens in the CSV plus keys of the translation table. */
export function listCategoryPaths(dataset: CategoryDataset): string[] {
  const column = categoryColumnIndex(dataset);
  const paths = new Set<string>(Object.keys(dataset.translations));
  for (const record of dataset.records) {
    for (const token of splitCategoryCell(record[column] ?? '')) paths.add(token);
  }
  return [...paths].sort();
}

export function categoryExists(dataset: CategoryDataset, path: string): boolean {
  if (Object.hasOwn(dataset.translations, path)) return true;
  const column = categoryColumnIndex(dataset);
  return dataset.records.some((record) => splitCategoryCell(record[column] ?? '').includes(path));
}

export function summarizeCategories(dataset: CategoryDataset): CategorySummary[] {
  const column = categoryColumnIndex(dataset);
  const counts = new Map<string, number>();
  for (const record of dataset.records) {
    const tokens = splitCategoryCell(record[column] ?? '');
    // Count each path once per row even when the row lists several of its descendants.
    const touched = new Set<string>();
    for (const token of tokens) {
      const parts = token.split('/');
      for (let depth = 1; depth <= parts.length; depth += 1) touched.add(parts.slice(0, depth).join('/'));
    }
    for (const path of touched) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return listCategoryPaths(dataset).map((path) => {
    const translation = Object.hasOwn(dataset.translations, path) ? dataset.translations[path] : null;
    return { path, en: translation?.en ?? null, ko: translation?.ko ?? null, count: counts.get(path) ?? 0 };
  });
}

function translationOf(dataset: CategoryDataset, path: string): CategoryTranslation | null {
  return Object.hasOwn(dataset.translations, path) ? dataset.translations[path] : null;
}

/** Full EN/KO names for `path` from its parent's translations plus the given leaf names. */
function composeTranslation(
  dataset: CategoryDataset,
  path: string,
  leaf: CategoryTranslation,
): CategoryTranslation {
  const parent = parentOf(path);
  if (parent === null) return { en: leaf.en, ko: leaf.ko };
  const parentTranslation = translationOf(dataset, parent);
  if (!parentTranslation) {
    throw new CategoryOperationError(`親カテゴリ「${parent}」に対訳がありません。先に親の対訳を登録してください`);
  }
  return { en: `${parentTranslation.en}/${leaf.en}`, ko: `${parentTranslation.ko}/${leaf.ko}` };
}

function resolveColor(dataset: CategoryDataset, topLevel: string): string {
  return Object.hasOwn(dataset.colors, topLevel) ? dataset.colors[topLevel] : getCategoryColor(topLevel);
}

function cloneDataset(dataset: CategoryDataset): CategoryDataset {
  return {
    header: [...dataset.header],
    records: dataset.records.map((record) => [...record]),
    translations: Object.fromEntries(
      Object.entries(dataset.translations).map(([key, value]) => [key, { ...value }]),
    ),
    colors: { ...dataset.colors },
  };
}

function requireExisting(dataset: CategoryDataset, path: string, label: string): void {
  if (!categoryExists(dataset, path)) {
    throw new CategoryOperationError(`${label}「${path}」は存在しません`, 404);
  }
}

function requireEditable(path: string): void {
  if (isProtected(path)) {
    throw new CategoryOperationError(`「${path}」はアプリが自動で扱うカテゴリなので変更できません`);
  }
}

function requireParent(dataset: CategoryDataset, path: string): void {
  const parent = parentOf(path);
  if (parent !== null && !categoryExists(dataset, parent)) {
    throw new CategoryOperationError(`親カテゴリ「${parent}」が存在しません`);
  }
}

/**
 * Replace `from` (and descendants) by `to` in every Category cell. Ancestors of the new
 * path are inserted so a move to another parent keeps the "child implies parent" invariant.
 */
function rewriteRecords(dataset: CategoryDataset, from: string, to: string | null): number {
  const column = categoryColumnIndex(dataset);
  let changedRows = 0;
  for (const record of dataset.records) {
    const tokens = splitCategoryCell(record[column] ?? '');
    if (!tokens.some((token) => isSelfOrDescendant(token, from))) continue;
    const rewritten = tokens.flatMap((token) => {
      if (!isSelfOrDescendant(token, from)) return [token];
      return to === null ? [] : [replacePathPrefix(token, from, to)];
    });
    const next = withAncestors(rewritten);
    if (!sameTokens(tokens, next)) changedRows += 1;
    record[column] = next.join(',');
  }
  return changedRows;
}

/** Move translation entries of `from` and its descendants under `to`, re-prefixing EN/KO. */
function moveTranslations(
  dataset: CategoryDataset,
  from: string,
  to: string,
  target: CategoryTranslation,
  options: { keepExistingTarget: boolean },
): void {
  const source = translationOf(dataset, from);
  const keys = Object.keys(dataset.translations).filter((key) => isSelfOrDescendant(key, from));
  for (const key of keys) {
    const entry = dataset.translations[key];
    delete dataset.translations[key];
    const nextKey = replacePathPrefix(key, from, to);
    if (options.keepExistingTarget && Object.hasOwn(dataset.translations, nextKey)) continue;
    if (key === from) {
      dataset.translations[nextKey] = { ...target };
      continue;
    }
    const nextEntry = { ...entry };
    for (const language of CATEGORY_LANGUAGES) {
      const oldPrefix = source ? `${source[language]}/` : null;
      if (oldPrefix && entry[language].startsWith(oldPrefix)) {
        nextEntry[language] = `${target[language]}/${entry[language].slice(oldPrefix.length)}`;
      }
    }
    dataset.translations[nextKey] = nextEntry;
  }
  if (!Object.hasOwn(dataset.translations, to)) dataset.translations[to] = { ...target };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function createCategory(
  input: CategoryDataset,
  request: { path: unknown; en: unknown; ko: unknown },
): CategoryChange {
  const path = validateCategoryPath(request.path);
  const leaf = { en: validateTranslationLeaf(request.en, 'en'), ko: validateTranslationLeaf(request.ko, 'ko') };
  if (categoryExists(input, path)) {
    throw new CategoryOperationError(`カテゴリ「${path}」は既に存在します`, 409);
  }
  requireEditable(path);
  requireParent(input, path);
  const dataset = cloneDataset(input);
  dataset.translations[path] = composeTranslation(dataset, path, leaf);
  if (parentOf(path) === null) dataset.colors[path] = resolveColor(dataset, path);
  return { dataset, changedRows: 0, message: `Create category ${path}` };
}

/** Set (or replace) the translation of an existing category without touching the CSV. */
export function translateCategory(
  input: CategoryDataset,
  request: { path: unknown; en: unknown; ko: unknown },
): CategoryChange {
  const path = validateCategoryPath(request.path);
  const leaf = { en: validateTranslationLeaf(request.en, 'en'), ko: validateTranslationLeaf(request.ko, 'ko') };
  requireExisting(input, path, 'カテゴリ');
  const dataset = cloneDataset(input);
  const target = composeTranslation(dataset, path, leaf);
  // Children carry the parent's EN/KO as a prefix, so they follow the new names.
  moveTranslations(dataset, path, path, target, { keepExistingTarget: false });
  return { dataset, changedRows: 0, message: `Translate category ${path}` };
}

/**
 * Rename or move `from` to `to` (a full path). `en`/`ko` are the leaf names of the renamed
 * node; the new parent's translations are prepended. Descendants follow in all files.
 */
export function renameCategory(
  input: CategoryDataset,
  request: { from: unknown; to: unknown; en: unknown; ko: unknown },
): CategoryChange {
  const from = validateCategoryPath(request.from, '現在のカテゴリ名');
  const to = validateCategoryPath(request.to, '新しいカテゴリ名');
  if (from === to) return translateCategory(input, { path: to, en: request.en, ko: request.ko });
  const leaf = { en: validateTranslationLeaf(request.en, 'en'), ko: validateTranslationLeaf(request.ko, 'ko') };
  requireEditable(from);
  requireEditable(to);
  requireExisting(input, from, 'カテゴリ');
  if (to.startsWith(`${from}/`)) {
    throw new CategoryOperationError(`「${from}」を自分の配下「${to}」には移動できません`);
  }
  if (categoryExists(input, to)) {
    throw new CategoryOperationError(`カテゴリ「${to}」は既に存在します。まとめる場合は「統合」を使ってください`, 409);
  }
  requireParent(input, to);
  const dataset = cloneDataset(input);
  const target = composeTranslation(dataset, to, leaf);
  const changedRows = rewriteRecords(dataset, from, to);
  moveTranslations(dataset, from, to, target, { keepExistingTarget: false });
  const fromTop = parentOf(from) === null;
  const toTop = parentOf(to) === null;
  if (fromTop || toTop) {
    // Keep the colour the rows were showing: a top-level rename carries it over, a promoted
    // child inherits its former top-level colour, a demoted top-level follows its new parent.
    const color = resolveColor(dataset, topLevelOf(from));
    if (fromTop) delete dataset.colors[from];
    if (toTop) dataset.colors[to] = color;
  }
  return { dataset, changedRows, message: `Rename category ${from} → ${to} (${changedRows} rows)` };
}

/** Fold `from` (and descendants) into the existing category `into`. */
export function mergeCategory(
  input: CategoryDataset,
  request: { from: unknown; into: unknown },
): CategoryChange {
  const from = validateCategoryPath(request.from, '統合元');
  const into = validateCategoryPath(request.into, '統合先');
  if (from === into) throw new CategoryOperationError('統合元と統合先が同じです');
  requireEditable(from);
  requireEditable(into);
  requireExisting(input, from, '統合元');
  requireExisting(input, into, '統合先');
  if (into.startsWith(`${from}/`) || from.startsWith(`${into}/`)) {
    throw new CategoryOperationError('親子関係にあるカテゴリ同士は統合できません');
  }
  const dataset = cloneDataset(input);
  const target = translationOf(dataset, into);
  if (!target) {
    throw new CategoryOperationError(`統合先「${into}」に対訳がありません。先に対訳を登録してください`);
  }
  const changedRows = rewriteRecords(dataset, from, into);
  moveTranslations(dataset, from, into, target, { keepExistingTarget: true });
  if (parentOf(from) === null) delete dataset.colors[from];
  return { dataset, changedRows, message: `Merge category ${from} into ${into} (${changedRows} rows)` };
}

/** Remove `path` and its descendants from every row and from the translation table. */
export function deleteCategory(input: CategoryDataset, request: { path: unknown }): CategoryChange {
  const path = validateCategoryPath(request.path);
  requireEditable(path);
  requireExisting(input, path, 'カテゴリ');
  const dataset = cloneDataset(input);
  const changedRows = rewriteRecords(dataset, path, null);
  for (const key of Object.keys(dataset.translations)) {
    if (isSelfOrDescendant(key, path)) delete dataset.translations[key];
  }
  if (parentOf(path) === null) delete dataset.colors[path];
  return { dataset, changedRows, message: `Delete category ${path} (${changedRows} rows)` };
}

// ---------------------------------------------------------------------------
// Serialization (sorted keys so every writer produces the same diff)
// ---------------------------------------------------------------------------

function sortedEntries<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
}

export function serializeCategoryTranslations(translations: CategoryTranslations): string {
  return `${JSON.stringify(sortedEntries(translations), null, 2)}\n`;
}

export function serializeCategoryColors(colors: CategoryColors): string {
  return `${JSON.stringify(sortedEntries(colors), null, 2)}\n`;
}
