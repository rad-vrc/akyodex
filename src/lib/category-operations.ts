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
/**
 * 各言語の完全なパス（`Animal/Horse`）。まだ訳していない階層は `null`。
 * 対訳は後付けでよく、揃うまでは日本語のまま表示する
 */
export type CategoryTranslation = Record<CategoryLanguage, string | null>;
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
  /** Paths this operation registered, outermost first. Only `create` sets it. */
  createdPaths?: string[];
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

export function isSelfOrDescendant(token: string, path: string): boolean {
  return token === path || token.startsWith(`${path}/`);
}

function replacePathPrefix(token: string, from: string, to: string): string {
  return token === from ? to : `${to}${token.slice(from.length)}`;
}

/** Categories the app adds and reads by name; they must not be renamed or assigned by hand. */
export function isProtectedCategoryPath(path: string): boolean {
  return PROTECTED_TOP_LEVEL.has(topLevelOf(path).toLowerCase());
}

function isProtected(path: string): boolean {
  return isProtectedCategoryPath(path);
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

/**
 * その階層の名前だけ。空なら `null`（未対訳）を返す。
 *
 * 対訳は任意。EN/KO は 1 年ずっと手作業の後付けで、入力を必須にすると日本語だけの
 * 登録ができず、他の人にカテゴリを足してもらえない。揃うまでは日本語で表示する。
 * `of` は、その名前がどの階層のものかを言うために付ける（階層をまとめて作るときは
 * 欄が複数並ぶので、どれが不正なのかを名指ししないと利用者が直せない）。
 */
export function validateTranslationLeaf(
  value: unknown,
  language: CategoryLanguage,
  of?: string,
): string | null {
  const labels: Record<CategoryLanguage, string> = { en: '英語名', ko: '韓国語名' };
  const label = of ? `「${of}」の${labels[language]}` : labels[language];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new CategoryOperationError(`${label}の形式が不正です`);
  }
  if (value.trim() === '') return null;
  if (value !== value.trim()) {
    throw new CategoryOperationError(`${label}の前後に空白は使えません`);
  }
  if (/[,、/]/.test(value)) {
    throw new CategoryOperationError(`${label}に「,」「、」「/」は使えません（親の名前は自動で付きます）`);
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

/**
 * Rows whose Category cell an operation rewrote, as `{ id, category }`. The admin screen
 * patches its catalog with these instead of waiting for the public JSON to be regenerated.
 */
export function listChangedCategoryRows(
  before: CategoryDataset,
  after: CategoryDataset,
): { id: string; category: string }[] {
  const idIndex = after.header.indexOf('ID');
  const categoryIndex = categoryColumnIndex(after);
  if (idIndex < 0) return [];
  const previous = new Map(before.records.map((record) => [record[idIndex], record[categoryColumnIndex(before)] ?? '']));
  const changed: { id: string; category: string }[] = [];
  for (const record of after.records) {
    const id = record[idIndex];
    const category = record[categoryIndex] ?? '';
    if (previous.get(id) !== category) changed.push({ id, category });
  }
  return changed;
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

/**
 * その言語で表示する名前。訳が無い階層は日本語のまま出す。
 *
 * 段ごとに落とすので、訳した分はそのまま活きる（`植物` が未対訳で `木` が Tree なら
 * `植物/Tree`）。全部揃うまで英語が一切出ない、という状態にはしない。
 */
export function resolveTranslation(
  dataset: CategoryDataset,
  path: string,
  language: CategoryLanguage,
): string {
  const stored = translationOf(dataset, path)?.[language];
  if (stored) return stored;
  const parent = parentOf(path);
  const leaf = path.slice(path.lastIndexOf('/') + 1);
  return parent === null ? leaf : `${resolveTranslation(dataset, parent, language)}/${leaf}`;
}

/**
 * Full EN/KO names for `path` from its parent's names plus the given leaf names.
 * 未入力の言語は `null` のまま置く。親が未対訳なら、その分は日本語が前に付く
 */
function composeTranslation(
  dataset: CategoryDataset,
  path: string,
  leaf: CategoryTranslation,
): CategoryTranslation {
  const parent = parentOf(path);
  const compose = (language: CategoryLanguage): string | null => {
    const name = leaf[language];
    if (name === null) return null;
    return parent === null ? name : `${resolveTranslation(dataset, parent, language)}/${name}`;
  };
  return { en: compose('en'), ko: compose('ko') };
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

/**
 * 名前が同じかどうかを見るときの畳み込み。表記ゆれを吸収する。
 * 存在判定には使わない（そちらは完全一致）。「並べたときに見分けが付くか」の判定用
 */
export function foldCategoryName(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}

/** 畳み込んだ名前 → その形を持つ既存カテゴリ。1 操作につき 1 回だけ作る */
function foldedCategoryIndex(dataset: CategoryDataset): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const existing of listCategoryPaths(dataset)) {
    const key = foldCategoryName(existing);
    const bucket = index.get(key);
    if (bucket) bucket.push(existing);
    else index.set(key, [existing]);
  }
  return index;
}

/** 「その名前は使えない」と伝える文言。画面とサーバーで同じ言い方にするため 1 か所に置く */
export function lookAlikeCategoryMessage(
  conflicts: { path: string; similarTo: readonly string[] }[],
): string {
  const described = conflicts
    .map((conflict) => `「${conflict.path}」は既存の「${conflict.similarTo.join('」「')}」`)
    .join('、');
  return `${described}と大文字小文字や表記だけが違います。並ぶと見分けが付かないので、別の名前にしてください。まとめる場合は「統合」を使ってください`;
}

/**
 * 表記ゆれだけが違うカテゴリを増やさせない。
 *
 * 完全一致では無いのでこれまでの検査は通ってしまうが、一覧に並ぶと見分けが付かず、
 * どちらに付けたのか誰も分からなくなる。画面側にも同じ判定はあるが、規則そのものは
 * 他のカテゴリ規則と同じくここで守る（API を直接叩いても通らないように）。
 *
 * `paths` はその操作が新しく登場させるパス全部。改名は宛先だけでなく、書き換わる
 * 子孫の新しいパスも見ないと、子の側で並んでしまう。`ignore` は判定から外す既存
 * （改名で表記だけを直す場合、自分自身と衝突してはいけない）。
 */
function requireNoLookAlike(
  dataset: CategoryDataset,
  paths: string[],
  ignore: (existing: string) => boolean = () => false,
): void {
  const index = foldedCategoryIndex(dataset);
  const conflicts: { path: string; similarTo: string[] }[] = [];
  for (const path of paths) {
    const similarTo = (index.get(foldCategoryName(path)) ?? []).filter(
      (existing) => existing !== path && !ignore(existing),
    );
    if (similarTo.length > 0) conflicts.push({ path, similarTo });
  }
  if (conflicts.length > 0) {
    throw new CategoryOperationError(lookAlikeCategoryMessage(conflicts), 409);
  }
}

function requireParent(dataset: CategoryDataset, path: string): void {
  const parent = parentOf(path);
  if (parent !== null && !categoryExists(dataset, parent)) {
    throw new CategoryOperationError(`親カテゴリ「${parent}」が存在しません`);
  }
}

/** Ancestors of `path` that do not exist yet, outermost first. */
function missingAncestors(dataset: CategoryDataset, path: string): string[] {
  const segments = path.split('/');
  const missing: string[] = [];
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = segments.slice(0, depth).join('/');
    if (!categoryExists(dataset, ancestor)) missing.push(ancestor);
  }
  return missing;
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

function translationLeaf(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1);
}

/**
 * Move translation entries of `from` and its descendants under `to`.
 *
 * Descendants are rebuilt top-down from the parent that ends up in the table, not from the
 * source prefix: when a merge keeps an existing `to/child` (with its own EN/KO), the
 * grandchildren must follow that kept entry, otherwise `to/child/grandchild` would carry
 * the old child's name and break the parent-prefix invariant CI enforces.
 */
function moveTranslations(
  dataset: CategoryDataset,
  from: string,
  to: string,
  target: CategoryTranslation,
  options: { keepExistingTarget: boolean },
): void {
  const moved = Object.keys(dataset.translations)
    .filter((key) => isSelfOrDescendant(key, from))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const entries = new Map(moved.map((key) => [key, dataset.translations[key]]));
  for (const key of moved) delete dataset.translations[key];
  for (const key of moved) {
    const nextKey = replacePathPrefix(key, from, to);
    if (options.keepExistingTarget && Object.hasOwn(dataset.translations, nextKey)) continue;
    if (key === from) {
      dataset.translations[nextKey] = { ...target };
      continue;
    }
    const entry = entries.get(key)!;
    const parentPath = parentOf(nextKey)!;
    const rebuild = (language: CategoryLanguage): string | null => {
      const own = entry[language];
      // 未対訳のまま動かす。親が訳されていてもここは訳さない
      if (own === null) return null;
      return `${resolveTranslation(dataset, parentPath, language)}/${translationLeaf(own)}`;
    };
    dataset.translations[nextKey] = { en: rebuild('en'), ko: rebuild('ko') };
  }
  if (!Object.hasOwn(dataset.translations, to)) dataset.translations[to] = { ...target };
}

/**
 * The invariant `scripts/category-translations.test.js` enforces on the committed file:
 * every child key is in the table and its EN/KO start with the parent's displayed name.
 * 訳が入っていない階層（`null`）は日本語で表示されるので、その前提で照合する。
 * Checked again right before a commit so no operation can write what CI would reject.
 */
export function assertTranslationHierarchy(translations: CategoryTranslations): void {
  const dataset: CategoryDataset = { header: ['Category'], records: [], translations, colors: {} };
  for (const [path, entry] of Object.entries(translations)) {
    const parent = parentOf(path);
    if (parent === null) continue;
    if (!Object.hasOwn(translations, parent)) {
      throw new CategoryOperationError(`対訳の整合性エラー: 「${path}」の親「${parent}」がありません`, 500);
    }
    for (const language of CATEGORY_LANGUAGES) {
      const value = entry[language];
      if (value === null) continue;
      const prefix = `${resolveTranslation(dataset, parent, language)}/`;
      if (!value.startsWith(prefix)) {
        throw new CategoryOperationError(
          `対訳の整合性エラー: 「${path}」の ${language}「${value}」が親の「${prefix}」で始まっていません`,
          500,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Create `path`, and every ancestor of it that does not exist yet.
 *
 * A whole new branch has to be creatable in one go: the Akyo screens cannot write an
 * unregistered category any more (`akyo-csv-snapshot.ts`), so if this only accepted a leaf
 * under an existing parent there would be no way to add `新しい親/新しい子` at all.
 *
 * Every level needs its own EN/KO, because a child's translation is its parent's plus the
 * child's leaf (`composeTranslation`). `ancestors` supplies those for the missing levels;
 * omitting one is an error rather than a guess, so no category is ever registered with a
 * name nobody chose.
 */
export function createCategory(
  input: CategoryDataset,
  request: { path: unknown; en: unknown; ko: unknown; ancestors?: unknown },
): CategoryChange {
  const path = validateCategoryPath(request.path);
  const leaf = {
    en: validateTranslationLeaf(request.en, 'en', path),
    ko: validateTranslationLeaf(request.ko, 'ko', path),
  };
  if (categoryExists(input, path)) {
    throw new CategoryOperationError(`カテゴリ「${path}」は既に存在します`, 409);
  }
  requireEditable(path);
  const missing = missingAncestors(input, path);
  const supplied = parseAncestorTranslations(request.ancestors, missing, ancestorsOf(path));
  // 作るパスをまとめて 1 回で見る。階層ごとに全件を舐め直さない
  requireNoLookAlike(input, [...missing, path]);
  const dataset = cloneDataset(input);
  for (const ancestor of missing) {
    requireEditable(ancestor);
    dataset.translations[ancestor] = composeTranslation(dataset, ancestor, supplied.get(ancestor)!);
    if (parentOf(ancestor) === null) dataset.colors[ancestor] = resolveColor(dataset, ancestor);
  }
  dataset.translations[path] = composeTranslation(dataset, path, leaf);
  if (parentOf(path) === null) dataset.colors[path] = resolveColor(dataset, path);
  const createdPaths = [...missing, path];
  return {
    dataset,
    changedRows: 0,
    message:
      createdPaths.length === 1
        ? `Create category ${path}`
        : `Create categories ${createdPaths.join(', ')}`,
    createdPaths,
  };
}

/** Every ancestor of `path`, outermost first (excluding `path` itself). */
function ancestorsOf(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * EN/KO for each level in `missing`, keyed by path.
 *
 * 既に存在する階層が混ざっていても捨てるだけで、エラーにはしない。画面はどの階層を
 * 訊くかを自分が持つ一覧から決めるので、その一覧が少しでも古いと「サーバー側では既に
 * ある階層」を送ってしまう。そこで拒否すると、画面上に満たす手段が無いフォームになる。
 * 書き込むのは `missing` の階層だけなので、既存の対訳が上書きされることはない。
 * 一方、そもそも対象パスの親ではないものは要求の作りが違うので拒否する。
 */
function parseAncestorTranslations(
  value: unknown,
  missing: string[],
  ancestors: string[],
): Map<string, CategoryTranslation> {
  const entries = new Map<string, CategoryTranslation>();
  if (value !== undefined && !Array.isArray(value)) {
    throw new CategoryOperationError('親階層の対訳の形式が不正です');
  }
  for (const item of (value as unknown[] | undefined) ?? []) {
    if (typeof item !== 'object' || item === null) {
      throw new CategoryOperationError('親階層の対訳の形式が不正です');
    }
    const entry = item as Record<string, unknown>;
    const ancestorPath = validateCategoryPath(entry.path, '親カテゴリ名');
    if (!ancestors.includes(ancestorPath)) {
      throw new CategoryOperationError(`「${ancestorPath}」はこのカテゴリの親階層ではありません`);
    }
    if (!missing.includes(ancestorPath)) continue;
    if (entries.has(ancestorPath)) {
      throw new CategoryOperationError(`親カテゴリ「${ancestorPath}」が重複しています`);
    }
    entries.set(ancestorPath, {
      en: validateTranslationLeaf(entry.en, 'en', ancestorPath),
      ko: validateTranslationLeaf(entry.ko, 'ko', ancestorPath),
    });
  }
  const unsupplied = missing.filter((ancestor) => !entries.has(ancestor));
  if (unsupplied.length > 0) {
    throw new CategoryOperationError(
      `親カテゴリ「${unsupplied.join('」「')}」がまだ存在しません。まとめて作るには、その階層の英語名・韓国語名も入力してください`,
    );
  }
  return entries;
}

/** Set (or replace) the translation of an existing category without touching the CSV. */
export function translateCategory(
  input: CategoryDataset,
  request: { path: unknown; en: unknown; ko: unknown },
): CategoryChange {
  const path = validateCategoryPath(request.path);
  const leaf = {
    en: validateTranslationLeaf(request.en, 'en', path),
    ko: validateTranslationLeaf(request.ko, 'ko', path),
  };
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
  const leaf = {
    en: validateTranslationLeaf(request.en, 'en', to),
    ko: validateTranslationLeaf(request.ko, 'ko', to),
  };
  requireEditable(from);
  requireEditable(to);
  requireExisting(input, from, 'カテゴリ');
  if (to.startsWith(`${from}/`)) {
    throw new CategoryOperationError(`「${from}」を自分の配下「${to}」には移動できません`);
  }
  if (categoryExists(input, to)) {
    throw new CategoryOperationError(`カテゴリ「${to}」は既に存在します。まとめる場合は「統合」を使ってください`, 409);
  }
  // 宛先だけでなく、書き換わる子孫の新しいパスも見る。子の側で並ばれても同じこと。
  // `from` 自身の付け替え先が `to` なので、この一覧に宛先も含まれている。
  // 表記だけを直す改名（Cat → cat）では自分自身と衝突するので、自分と配下は外す
  const introduced = listCategoryPaths(input)
    .filter((existing) => isSelfOrDescendant(existing, from))
    .map((existing) => replacePathPrefix(existing, from, to));
  requireNoLookAlike(input, introduced, (existing) => isSelfOrDescendant(existing, from));
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
