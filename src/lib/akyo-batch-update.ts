import { stringify } from 'csv-stringify/sync';
import { EDIT_FIELD_NAMES, MAX_BATCH_UPDATES, getAkyoEditFields, sameAkyoEditFields, type AkyoEditFields, type PendingAkyoUpdate } from './akyo-edit-fields';
import { parseAkyoFormData, jsonError, type AkyoFormData } from './api-helpers';
import { prepareAkyoUpdate } from './akyo-crud-helpers';
import { splitCategoryCell } from './category-operations';
import { parseCsvToAkyoData, parseLoadedAkyoCsvContent, stringifyAkyoCsv } from './csv-utils';
import { GitHubConflictError, commitFilesToGitHub, fetchFileFromGitHub, getBranchHead } from './github-utils';

const CSV_PATH = 'data/akyo-data-ja.csv';
const TRANSLATIONS_PATH = 'data/category-translations.json';

export interface AkyoBatchSnapshot {
  /** Commit every file below was read from, and the parent the write must apply to. */
  head: string;
  header: string[];
  dataRecords: string[][];
  /**
   * Categories an update may reference beyond those already in the CSV: the registered ones
   * no Akyo uses yet. Writing a token outside the union would resurrect a renamed or deleted
   * category with no translation, which the EN/KO regeneration then drops.
   */
  registeredCategories: Set<string>;
}

export interface AkyoBatchDependencies {
  loadSnapshot: () => Promise<AkyoBatchSnapshot>;
  commit: (args: {
    parentSha: string;
    header: string[];
    dataRecords: string[][];
    message: string;
  }) => Promise<{ commit: { html_url: string } }>;
}

/**
 * Read the CSV and the category registry from one commit. Deleting an unused category only
 * rewrites the translations file, so a guard on the CSV alone would not notice it; the write
 * below applies to this same commit and fails if the branch moved at all.
 */
async function loadAkyoSnapshot(): Promise<AkyoBatchSnapshot> {
  const head = await getBranchHead();
  const [csv, translations] = await Promise.all([
    fetchFileFromGitHub(CSV_PATH, undefined, undefined, head),
    fetchFileFromGitHub(TRANSLATIONS_PATH, undefined, undefined, head),
  ]);
  const parsed: unknown = JSON.parse(translations.content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('category-translations.json の形式が不正です');
  }
  const { header, dataRecords } = parseLoadedAkyoCsvContent(csv.content);
  return { head, header, dataRecords, registeredCategories: new Set(Object.keys(parsed)) };
}

async function commitAkyoSnapshot({
  parentSha,
  header,
  dataRecords,
  message,
}: Parameters<AkyoBatchDependencies['commit']>[0]) {
  return commitFilesToGitHub({
    files: [{ path: CSV_PATH, content: stringifyAkyoCsv(header, dataRecords) }],
    message,
    parentSha,
  });
}

function isFields(value: unknown): value is AkyoEditFields {
  return typeof value === 'object' && value !== null &&
    EDIT_FIELD_NAMES.every((key) => Object.hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === 'string');
}

export async function processAkyoBatchUpdate(
  input: unknown,
  dependencies: Partial<AkyoBatchDependencies> = {},
): Promise<Response> {
  const { loadSnapshot = loadAkyoSnapshot, commit = commitAkyoSnapshot } = dependencies;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_BATCH_UPDATES) {
    return jsonError('更新は1件から100件までまとめて反映できます', 400);
  }
  const updates: { draft: PendingAkyoUpdate; form: AkyoFormData }[] = [];
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || !isFields(item.original) || !isFields(item.changes) || item.original.id !== item.changes.id) {
      return jsonError('更新データの形式が不正です', 400);
    }
    const fields = new FormData();
    for (const key of EDIT_FIELD_NAMES) fields.set(key, item.changes[key]);
    const parsed = parseAkyoFormData(fields);
    if (!parsed.success) return jsonError(`#${item.changes.id}: ${parsed.error}`, parsed.status);
    if (ids.has(parsed.data.id)) return jsonError(`ID ${parsed.data.id} が重複しています`, 400);
    ids.add(parsed.data.id);
    updates.push({ draft: item, form: parsed.data });
  }

  try {
    const { head, header, dataRecords, registeredCategories } = await loadSnapshot();
    const currentData = parseCsvToAkyoData(stringify([header, ...dataRecords]));
    // Compare the edited records, not the entire catalog: unrelated registrations can proceed.
    for (const { draft } of updates) {
      const current = currentData.find((akyo) => akyo.id === draft.original.id);
      if (!current || !sameAkyoEditFields(getAkyoEditFields(current), draft.original)) {
        return jsonError(`#${draft.original.id} は別の更新または削除が行われています。最新データを確認してください。保留内容は維持されています。`, 409);
      }
    }
    // The rule belongs here rather than in one screen's pre-flight, so every client of this
    // batch API is covered. Note that the single-entry CRUD path (upload/update/delete-akyo,
    // see akyo-crud-helpers.ts) still writes categories without this check.
    const categoryIndex = header.indexOf('Category');
    const known = new Set(registeredCategories);
    for (const record of dataRecords) {
      for (const token of splitCategoryCell(categoryIndex >= 0 ? record[categoryIndex] ?? '' : '')) known.add(token);
    }
    const unknown = [...new Set(updates.flatMap(({ form }) => splitCategoryCell(form.category)))]
      .filter((token) => !known.has(token));
    if (unknown.length > 0) {
      return jsonError(
        `存在しないカテゴリが含まれています: ${unknown.join(', ')}。改名または削除された可能性があります。ページを再読み込みして最新のカテゴリを取り込んでください。保留内容は維持されています。`,
        400,
      );
    }
    let records = dataRecords;
    for (const { form } of updates) records = prepareAkyoUpdate(form, records, header);
    const savedData = parseCsvToAkyoData(stringify([header, ...records])).filter((akyo) => ids.has(akyo.id));
    // One commit on the very revision the checks above were made against, applied without
    // force: anything pushed in between (a CSV row, a category rename, a category deletion
    // that only touches the translations file) makes the ref update fail instead of winning.
    const committed = await commit({
      parentSha: head, header, dataRecords: records,
      message: `Update ${updates.length} Akyo: ${[...ids].map((id) => `#${id}`).join(', ')}`,
    });
    return Response.json({ success: true, message: `${updates.length}件の更新を反映しました`, commitUrl: committed.commit.html_url, data: savedData });
  } catch (error) {
    if (error instanceof GitHubConflictError) {
      return jsonError('他の更新が先に入りました。ページを再読み込みして最新のデータを取り込んでから、もう一度お試しください。保留内容は維持されています。', 409);
    }
    console.error('[akyo-batch-update] Failed:', error);
    return jsonError('更新を反映できませんでした。保留内容は維持されています。通信エラーの場合はコミット状況を確認してから再試行してください。', 500);
  }
}
