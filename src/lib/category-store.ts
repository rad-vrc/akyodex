/**
 * Read the three category files from one commit and write them back as one commit.
 *
 * Server-only (GitHub token). The pure operations live in `category-operations.ts`;
 * this module only knows where the files are and how to move them.
 */

import { parseLoadedAkyoCsvContent, stringifyAkyoCsv } from './csv-utils';
import {
  CATEGORY_LANGUAGES,
  CategoryOperationError,
  assertTranslationHierarchy,
  serializeCategoryColors,
  serializeCategoryTranslations,
  type CategoryChange,
  type CategoryColors,
  type CategoryDataset,
  type CategoryTranslation,
  type CategoryTranslations,
} from './category-operations';
import {
  commitFilesToGitHub,
  fetchFileFromGitHub,
  getBranchHead,
  type GitHubCommitResponse,
  type GitHubConfig,
  type GitHubFileChange,
} from './github-utils';

export const CATEGORY_FILE_PATHS = {
  csv: 'data/akyo-data-ja.csv',
  translations: 'data/category-translations.json',
  colors: 'src/lib/category-colors.json',
} as const;

export interface CategorySnapshot {
  /** Commit every file was read from; the write goes on top of exactly this commit. */
  head: string;
  /**
   * 一覧が見ていたカテゴリの材料（日本語 CSV・対訳・色）の版。3 ファイルの blob SHA を並べる。
   *
   * 古い画面からの変更を止めるのに head は使わない。head は main のどのコミットでも動き、
   * カテゴリを変えるたびに走る自動 sync の bot コミットでも 1 分以内に動く。head で比べると、
   * 変更の直後に続けた操作が、材料は何も変わっていないのに 409 になる（2026-09-11、色/黒 の
   * 改名の 43 秒後に sync が入り、同じ一覧から 色/青色系 を作れなくなった）。
   *
   * 版が sync で動かないのは、sync（scripts/sync-catalog-data.js）が許可リスト
   * `generatedPaths` に載ったファイルしかコミットせず、リスト外が変わると止まるから。
   * 材料の 3 ファイルはそのリストに無い（category-store.test.ts で固定）。
   */
  revision: string;
  dataset: CategoryDataset;
  /** Canonical serializations of what was read, to skip files an operation left unchanged. */
  original: { translations: string; colors: string };
}

export interface CategoryStoreDeps {
  getBranchHead: (config?: GitHubConfig) => Promise<string>;
  fetchFile: (
    filePath: string,
    config?: GitHubConfig,
    timeoutMs?: number,
    ref?: string,
  ) => Promise<{ content: string; sha: string }>;
  commitFiles: (args: {
    files: GitHubFileChange[];
    message: string;
    parentSha: string;
    config?: GitHubConfig;
  }) => Promise<GitHubCommitResponse & { sha: string }>;
}

const defaultDeps: CategoryStoreDeps = {
  getBranchHead,
  fetchFile: fetchFileFromGitHub,
  commitFiles: commitFilesToGitHub,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same checks as scripts/category-translations.js, so the admin cannot write what CI rejects. */
export function parseCategoryTranslations(text: string): CategoryTranslations {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CategoryOperationError('category-translations.json を JSON として読めません', 500);
  }
  if (!isRecord(parsed)) {
    throw new CategoryOperationError('category-translations.json の形式が不正です', 500);
  }
  const result: CategoryTranslations = {};
  for (const [japanese, entry] of Object.entries(parsed)) {
    if (japanese.trim() === '' || japanese !== japanese.trim() || !isRecord(entry)) {
      throw new CategoryOperationError(`category-translations.json のキー ${JSON.stringify(japanese)} が不正です`, 500);
    }
    // 対訳は任意。未対訳は null（キーごと無い場合も null に揃える）。ここで拒否すると、
    // 日本語だけで作ったカテゴリの直後から一覧も操作も 500 で落ちる
    const translation: CategoryTranslation = { en: null, ko: null };
    for (const language of CATEGORY_LANGUAGES) {
      const value = entry[language];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
        throw new CategoryOperationError(
          `category-translations.json の ${JSON.stringify(japanese)} の ${language} が不正です`,
          500,
        );
      }
      translation[language] = value;
    }
    result[japanese] = translation;
  }
  return result;
}

export function parseCategoryColors(text: string): CategoryColors {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CategoryOperationError('category-colors.json を JSON として読めません', 500);
  }
  if (!isRecord(parsed)) {
    throw new CategoryOperationError('category-colors.json の形式が不正です', 500);
  }
  const result: CategoryColors = {};
  for (const [name, color] of Object.entries(parsed)) {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new CategoryOperationError(`category-colors.json の ${JSON.stringify(name)} が色コードではありません`, 500);
    }
    result[name] = color;
  }
  return result;
}

export async function loadCategorySnapshot(deps: CategoryStoreDeps = defaultDeps): Promise<CategorySnapshot> {
  const head = await deps.getBranchHead();
  const [csv, translations, colors] = await Promise.all([
    deps.fetchFile(CATEGORY_FILE_PATHS.csv, undefined, undefined, head),
    deps.fetchFile(CATEGORY_FILE_PATHS.translations, undefined, undefined, head),
    deps.fetchFile(CATEGORY_FILE_PATHS.colors, undefined, undefined, head),
  ]);
  const parsedCsv = parseLoadedAkyoCsvContent(csv.content);
  const dataset: CategoryDataset = {
    header: parsedCsv.header,
    records: parsedCsv.dataRecords,
    translations: parseCategoryTranslations(translations.content),
    colors: parseCategoryColors(colors.content),
  };
  return {
    head,
    revision: [csv.sha, translations.sha, colors.sha].join(':'),
    dataset,
    original: {
      translations: serializeCategoryTranslations(dataset.translations),
      colors: serializeCategoryColors(dataset.colors),
    },
  };
}

/** Only the files an operation actually changed; an untouched CSV is never re-serialized. */
export function buildCategoryCommitFiles(snapshot: CategorySnapshot, change: CategoryChange): GitHubFileChange[] {
  const files: GitHubFileChange[] = [];
  if (change.changedRows > 0) {
    files.push({
      path: CATEGORY_FILE_PATHS.csv,
      content: stringifyAkyoCsv(change.dataset.header, change.dataset.records),
    });
  }
  const translations = serializeCategoryTranslations(change.dataset.translations);
  if (translations !== snapshot.original.translations) {
    files.push({ path: CATEGORY_FILE_PATHS.translations, content: translations });
  }
  const colors = serializeCategoryColors(change.dataset.colors);
  if (colors !== snapshot.original.colors) {
    files.push({ path: CATEGORY_FILE_PATHS.colors, content: colors });
  }
  return files;
}

export async function commitCategoryChange(
  snapshot: CategorySnapshot,
  change: CategoryChange,
  deps: CategoryStoreDeps = defaultDeps,
): Promise<GitHubCommitResponse & { sha: string; files: string[] }> {
  assertTranslationHierarchy(change.dataset.translations);
  const files = buildCategoryCommitFiles(snapshot, change);
  if (files.length === 0) {
    throw new CategoryOperationError('変更がありません');
  }
  const result = await deps.commitFiles({ files, message: change.message, parentSha: snapshot.head });
  return { ...result, files: files.map((file) => file.path) };
}
