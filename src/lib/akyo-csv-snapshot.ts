/**
 * Reading and writing `data/akyo-data-ja.csv` as one revision.
 *
 * Every admin write goes through here so two rules hold for all of them:
 * - the CSV and the category registry are read from the same commit, and the write applies to
 *   that commit without force, so anything pushed in between fails instead of winning
 *   (deleting an unused category only rewrites the translations file, which a guard on the
 *   CSV blob alone would never notice);
 * - a category that no row carries and the registry does not know cannot be written, because
 *   the EN/KO regeneration has no translation for it and stops.
 */

import { splitCategoryCell } from './category-operations';
import { parseLoadedAkyoCsvContent, stringifyAkyoCsv } from './csv-utils';
import { commitFilesToGitHub, fetchFileFromGitHub, getBranchHead } from './github-utils';

export const AKYO_CSV_PATH = 'data/akyo-data-ja.csv';
export const CATEGORY_TRANSLATIONS_PATH = 'data/category-translations.json';

export interface AkyoCsvSnapshot {
  /** Commit every file below was read from, and the parent the write must apply to. */
  head: string;
  header: string[];
  dataRecords: string[][];
  /** Categories registered but not yet carried by any row. */
  registeredCategories: Set<string>;
}

export interface AkyoCsvCommit {
  parentSha: string;
  header: string[];
  dataRecords: string[][];
  message: string;
}

export async function loadAkyoCsvSnapshot(): Promise<AkyoCsvSnapshot> {
  const head = await getBranchHead();
  const [csv, translations] = await Promise.all([
    fetchFileFromGitHub(AKYO_CSV_PATH, undefined, undefined, head),
    fetchFileFromGitHub(CATEGORY_TRANSLATIONS_PATH, undefined, undefined, head),
  ]);
  const parsed: unknown = JSON.parse(translations.content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('category-translations.json の形式が不正です');
  }
  const { header, dataRecords } = parseLoadedAkyoCsvContent(csv.content);
  return { head, header, dataRecords, registeredCategories: new Set(Object.keys(parsed)) };
}

export async function commitAkyoCsvSnapshot({ parentSha, header, dataRecords, message }: AkyoCsvCommit) {
  return commitFilesToGitHub({
    files: [{ path: AKYO_CSV_PATH, content: stringifyAkyoCsv(header, dataRecords) }],
    message,
    parentSha,
  });
}

/** Tokens in `categoryCells` that neither the current CSV nor the registry knows. */
export function findUnregisteredCategories(
  snapshot: Pick<AkyoCsvSnapshot, 'header' | 'dataRecords' | 'registeredCategories'>,
  categoryCells: string[],
): string[] {
  const categoryIndex = snapshot.header.indexOf('Category');
  const known = new Set(snapshot.registeredCategories);
  for (const record of snapshot.dataRecords) {
    for (const token of splitCategoryCell(categoryIndex >= 0 ? record[categoryIndex] ?? '' : '')) {
      known.add(token);
    }
  }
  return [...new Set(categoryCells.flatMap((cell) => splitCategoryCell(cell)))].filter((token) => !known.has(token));
}

export function unregisteredCategoryMessage(tokens: string[]): string {
  return `存在しないカテゴリが含まれています: ${tokens.join(', ')}。改名または削除された可能性があります。ページを再読み込みして最新のカテゴリを取り込んでください。`;
}

export const CSV_CONFLICT_MESSAGE =
  '他の更新が先に入りました。ページを再読み込みして最新のデータを取り込んでから、もう一度お試しください。';
