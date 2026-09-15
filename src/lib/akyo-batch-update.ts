import { stringify } from 'csv-stringify/sync';
import { EDIT_FIELD_NAMES, MAX_BATCH_UPDATES, NICKNAME_LABEL, getAkyoEditFields, mergeAkyoEditFields, type AkyoEditFieldName, type AkyoEditFields, type PendingAkyoUpdate } from './akyo-edit-fields';
import { parseAkyoFormData, jsonError, type AkyoFormData } from './api-helpers';
import { prepareAkyoUpdate } from './akyo-crud-helpers';
import {
  CSV_CONFLICT_MESSAGE,
  commitAkyoCsvSnapshot,
  findUnregisteredCategories,
  loadAkyoCsvSnapshot,
  unregisteredCategoryMessage,
  type AkyoCsvCommit,
  type AkyoCsvSnapshot,
} from './akyo-csv-snapshot';
import { ensureCategoryAncestors } from './category-operations';
import { parseCsvToAkyoData } from './csv-utils';
import { GitHubConflictError } from './github-utils';

import type { AkyoEntryType } from '@/types/akyo';

export interface AkyoBatchDependencies {
  loadSnapshot: () => Promise<AkyoCsvSnapshot>;
  commit: (args: AkyoCsvCommit) => Promise<{ commit: { html_url: string } }>;
}

// 衝突した項目を、編集モーダルと同じ呼び名で名指しする
const FIELD_LABELS: Record<AkyoEditFieldName, string> = {
  id: 'ID', entryType: '種別', displaySerial: '表示番号', nickname: NICKNAME_LABEL.avatar, avatarName: 'アバター名',
  author: '作者', sourceUrl: 'VRChat URL', boothUrl: 'BOOTH URL', category: 'カテゴリ', comment: 'あきょうちしき',
};

function isFields(value: unknown): value is AkyoEditFields {
  return typeof value === 'object' && value !== null &&
    EDIT_FIELD_NAMES.every((key) => Object.hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === 'string');
}

function parseEditFields(fields: AkyoEditFields) {
  const form = new FormData();
  for (const key of EDIT_FIELD_NAMES) form.set(key, fields[key]);
  return parseAkyoFormData(form);
}

export async function processAkyoBatchUpdate(
  input: unknown,
  dependencies: Partial<AkyoBatchDependencies> = {},
): Promise<Response> {
  const { loadSnapshot = loadAkyoCsvSnapshot, commit = commitAkyoCsvSnapshot } = dependencies;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_BATCH_UPDATES) {
    return jsonError('更新は1件から100件までまとめて反映できます', 400);
  }
  const drafts: PendingAkyoUpdate[] = [];
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || !isFields(item.original) || !isFields(item.changes) || item.original.id !== item.changes.id) {
      return jsonError('更新データの形式が不正です', 400);
    }
    const parsed = parseEditFields(item.changes);
    if (!parsed.success) return jsonError(`#${item.changes.id}: ${parsed.error}`, parsed.status);
    if (ids.has(parsed.data.id)) return jsonError(`ID ${parsed.data.id} が重複しています`, 400);
    ids.add(parsed.data.id);
    drafts.push(item);
  }

  try {
    const snapshot = await loadSnapshot();
    const { head, header, dataRecords } = snapshot;
    const currentData = parseCsvToAkyoData(stringify([header, ...dataRecords]));
    // Compare the edited fields, not the whole record, let alone the catalog: unrelated
    // registrations and changes to other fields of the same row (an author label cleanup
    // merged as a data PR) proceed and are kept. Only a field both sides changed differently
    // is refused, and the row to cancel is named, because refetching alone cannot resolve it.
    const forms: AkyoFormData[] = [];
    for (const { original, changes } of drafts) {
      const current = currentData.find((akyo) => akyo.id === original.id);
      if (!current) {
        return jsonError(`#${original.id} は削除されています。#${original.id} の保留を取り消してから、もう一度反映してください。保留内容は維持されています。`, 409);
      }
      const { merged, conflicts } = mergeAkyoEditFields(original, changes, getAkyoEditFields(current));
      const retry = `#${original.id} の保留を取り消し、最新データを取り込んでから編集し直してください。保留内容は維持されています。`;
      if (conflicts.length > 0) {
        const labels = conflicts.map((key) =>
          (key === 'nickname' && NICKNAME_LABEL[changes.entryType as AkyoEntryType]) || FIELD_LABELS[key]);
        return jsonError(`#${original.id} の${labels.join('、')}は、別の更新でも変更されています。${retry}`, 409);
      }
      // 当て直した組み合わせは誰も検証していない（片方ずつは正しくても、合わせると URL が
      // 1 つも無い、などがあり得る）ので、書く前にもう一度通す
      const parsed = parseEditFields(merged);
      if (!parsed.success) {
        return jsonError(`#${original.id} は、別の更新と合わせると保存できない内容になります（${parsed.error}）。${retry}`, 409);
      }
      forms.push(parsed.data);
    }
    // The rule lives in the shared snapshot module, so the single-entry CRUD path applies it
    // too rather than each screen running its own pre-flight.
    // prepareAkyoUpdate が書くのは祖先を補ったカテゴリなので、検査も同じものを見る
    const unknown = findUnregisteredCategories(
      snapshot,
      forms.map((form) => ensureCategoryAncestors(form.category)),
    );
    if (unknown.length > 0) {
      return jsonError(`${unregisteredCategoryMessage(unknown)}保留内容は維持されています。`, 400);
    }
    let records = dataRecords;
    for (const form of forms) records = prepareAkyoUpdate(form, records, header);
    const savedData = parseCsvToAkyoData(stringify([header, ...records])).filter((akyo) => ids.has(akyo.id));
    // One commit on the very revision the checks above were made against, applied without
    // force: anything pushed in between (a CSV row, a category rename, a category deletion
    // that only touches the translations file) makes the ref update fail instead of winning.
    const committed = await commit({
      parentSha: head, header, dataRecords: records,
      message: `Update ${forms.length} Akyo: ${[...ids].map((id) => `#${id}`).join(', ')}`,
    });
    return Response.json({ success: true, message: `${forms.length}件の更新を反映しました`, commitUrl: committed.commit.html_url, data: savedData });
  } catch (error) {
    if (error instanceof GitHubConflictError) {
      return jsonError(`${CSV_CONFLICT_MESSAGE}保留内容は維持されています。`, 409);
    }
    console.error('[akyo-batch-update] Failed:', error);
    return jsonError('更新を反映できませんでした。保留内容は維持されています。通信エラーの場合はコミット状況を確認してから再試行してください。', 500);
  }
}
