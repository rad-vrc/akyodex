import type { AkyoData, AkyoEntryType } from '@/types/akyo';
import { getAkyoSourceUrl, normalizeVrchatSourceUrl } from './akyo-entry';

export const MAX_BATCH_UPDATES = 100;

/** 名前の欄の呼び名は種別で変わる。編集モーダルと、衝突した項目を名指しする反映 API で共有する */
export const NICKNAME_LABEL: Record<AkyoEntryType, string> = {
  avatar: 'ニックネーム',
  world: 'ワールド名',
  booth: '名前',
};

export const EDIT_FIELD_NAMES = [
  'id', 'entryType', 'displaySerial', 'nickname', 'avatarName', 'author',
  'sourceUrl', 'boothUrl', 'category', 'comment',
] as const;

export type AkyoEditFieldName = typeof EDIT_FIELD_NAMES[number];
export type AkyoEditFields = Record<AkyoEditFieldName, string>;
export interface PendingAkyoUpdate {
  original: AkyoEditFields;
  changes: AkyoEditFields;
}

export function getAkyoEditFields(akyo: AkyoData): AkyoEditFields {
  return {
    id: akyo.id,
    entryType: akyo.entryType || 'avatar',
    displaySerial: akyo.displaySerial || (akyo.entryType === 'world' ? '' : akyo.id),
    nickname: akyo.nickname.trim(),
    avatarName: akyo.avatarName.trim(),
    author: (akyo.author || akyo.creator || '').trim(),
    sourceUrl: normalizeVrchatSourceUrl(getAkyoSourceUrl(akyo)),
    boothUrl: (akyo.boothUrl || '').trim(),
    category: (akyo.category || akyo.attribute || '').trim(),
    comment: (akyo.comment || akyo.notes || '').trim(),
  };
}

export function applyAkyoEditFields(akyo: AkyoData, fields: AkyoEditFields): AkyoData {
  return {
    ...akyo,
    ...fields,
    entryType: fields.entryType === 'world' ? 'world' : fields.entryType === 'booth' ? 'booth' : 'avatar',
    creator: fields.author,
    attribute: fields.category,
    notes: fields.comment,
    avatarUrl: fields.sourceUrl,
  };
}

// CSV -> JSON inserts category ancestors and normalizes line endings.
// Compare the same representation without changing the submitted values.
function sameEditField(key: AkyoEditFieldName, a: string, b: string): boolean {
  const comparable = (value: string) => {
    if (key === 'comment') return value.replace(/\r\n?/g, '\n');
    if (key !== 'category') return value;
    return [...new Set(value.split(',').map((token) => token.trim()).filter(Boolean).flatMap((token) => {
      const parts = token.split('/');
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    }))].join(',');
  };
  return comparable(a) === comparable(b);
}

export function sameAkyoEditFields(a: AkyoEditFields, b: AkyoEditFields): boolean {
  return EDIT_FIELD_NAMES.every((key) => sameEditField(key, a[key], b[key]));
}

/**
 * 保留した編集を、保存先の今の行へ項目ごとに当て直す。`base` は保留したときに画面が持って
 * いた行、`mine` は保留した内容、`theirs` は保存先の今の行。
 *
 * - 自分が変えていない項目は、保存先の値を残す（別の更新を巻き戻さない）
 * - 自分だけが変えた項目、両方が同じ値に変えた項目は、自分の値を使う
 * - 両方が違う値に変えた項目だけを、衝突として返す
 *
 * 行を丸ごと比べると、作者の表記揃えのような無関係な更新が 1 つ入っただけで、その行の保留は
 * 二度と反映できない。保留は再取得しても保留したときの行（ここでの `base`）を持ち続けるので、
 * 取得し直しても解けない。
 */
export function mergeAkyoEditFields(
  base: AkyoEditFields,
  mine: AkyoEditFields,
  theirs: AkyoEditFields,
): { merged: AkyoEditFields; conflicts: AkyoEditFieldName[] } {
  const merged = { ...theirs };
  const conflicts: AkyoEditFieldName[] = [];
  for (const key of EDIT_FIELD_NAMES) {
    if (sameEditField(key, mine[key], base[key])) continue;
    if (sameEditField(key, theirs[key], base[key]) || sameEditField(key, theirs[key], mine[key])) {
      merged[key] = mine[key];
    } else {
      conflicts.push(key);
    }
  }
  return { merged, conflicts };
}
