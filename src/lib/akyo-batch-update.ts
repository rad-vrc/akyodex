import { stringify } from 'csv-stringify/sync';
import { EDIT_FIELD_NAMES, MAX_BATCH_UPDATES, getAkyoEditFields, sameAkyoEditFields, type AkyoEditFields, type PendingAkyoUpdate } from './akyo-edit-fields';
import { parseAkyoFormData, jsonError, type AkyoFormData } from './api-helpers';
import { prepareAkyoUpdate } from './akyo-crud-helpers';
import { splitCategoryCell } from './category-operations';
import { commitAkyoCsv, loadAkyoCsv, parseCsvToAkyoData } from './csv-utils';
import { fetchFileFromGitHub } from './github-utils';

/**
 * Categories an update may reference: every token some row already carries, plus the
 * registered ones that no Akyo uses yet. Writing a token outside this set would resurrect a
 * renamed or deleted category with no translation, which the EN/KO regeneration then drops.
 */
async function loadRegisteredCategories(): Promise<Set<string>> {
  const file = await fetchFileFromGitHub('data/category-translations.json');
  const parsed: unknown = JSON.parse(file.content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('category-translations.json の形式が不正です');
  }
  return new Set(Object.keys(parsed));
}

function isFields(value: unknown): value is AkyoEditFields {
  return typeof value === 'object' && value !== null &&
    EDIT_FIELD_NAMES.every((key) => Object.hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === 'string');
}

export async function processAkyoBatchUpdate(
  input: unknown,
  dependencies: {
    load?: typeof loadAkyoCsv;
    commit?: typeof commitAkyoCsv;
    loadRegistry?: () => Promise<Set<string>>;
  } = {},
): Promise<Response> {
  const { load = loadAkyoCsv, commit = commitAkyoCsv, loadRegistry = loadRegisteredCategories } = dependencies;
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
    const [{ header, dataRecords, fileSha }, registered] = await Promise.all([load(), loadRegistry()]);
    const currentData = parseCsvToAkyoData(stringify([header, ...dataRecords]));
    // Compare the edited records, not the entire catalog: unrelated registrations can proceed.
    for (const { draft } of updates) {
      const current = currentData.find((akyo) => akyo.id === draft.original.id);
      if (!current || !sameAkyoEditFields(getAkyoEditFields(current), draft.original)) {
        return jsonError(`#${draft.original.id} は別の更新または削除が行われています。最新データを確認してください。保留内容は維持されています。`, 409);
      }
    }
    // Every client (this panel, the edit modal, a script) writes categories through here, so
    // the "category must exist" rule belongs here rather than in one screen's pre-flight.
    const categoryIndex = header.indexOf('Category');
    const known = new Set(registered);
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
    // One SHA-guarded commit, only after every input and conflict check succeeds.
    const committed = await commit({
      header, dataRecords: records, fileSha,
      commitMessage: `Update ${updates.length} Akyo: ${[...ids].map((id) => `#${id}`).join(', ')}`,
    });
    return Response.json({ success: true, message: `${updates.length}件の更新を反映しました`, commitUrl: committed.commit.html_url, data: savedData });
  } catch (error) {
    console.error('[akyo-batch-update] Failed:', error);
    return jsonError('更新を反映できませんでした。保留内容は維持されています。通信エラーの場合はコミット状況を確認してから再試行してください。', 500);
  }
}
