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
function categoryTokens(value: string): Set<string> {
  return new Set(value.split(',').map((token) => token.trim()).filter(Boolean).flatMap((token) => {
    const parts = token.split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
}

function sameEditField(key: AkyoEditFieldName, a: string, b: string): boolean {
  const comparable = (value: string) => {
    if (key === 'comment') return value.replace(/\r\n?/g, '\n');
    if (key !== 'category') return value;
    return [...categoryTokens(value)].join(',');
  };
  return comparable(a) === comparable(b);
}

/** Apply membership changes to the latest set, never replay unchanged old category names. */
function mergeCategories(
  base: string, mine: string, theirs: string, unregisteredCategories: ReadonlySet<string>,
): string | null {
  const before = categoryTokens(base);
  const local = categoryTokens(mine);
  const remote = categoryTokens(theirs);
  const added = [...local].filter((token) => !before.has(token));
  const removed = [...before].filter((token) => !local.has(token));
  const remoteAdded = [...remote].filter((token) => !before.has(token));
  const remoteRemoved = [...before].filter((token) => !remote.has(token));
  // A subtree removal and a new descendant cannot both be honored. Do not silently
  // discard the new child or restore a parent the other editor explicitly removed.
  const crossesRemoval = (additions: string[], removals: string[]) =>
    additions.some((token) => removals.some((parent) => token.startsWith(`${parent}/`)));
  if (crossesRemoval(added, remoteRemoved) || crossesRemoval(remoteAdded, removed)) return null;

  // A retired name may have been renamed into one of the new remote tokens. Without
  // stable category IDs, silently treating its removal as already done can lose intent.
  if (remoteAdded.length > 0 && removed.some((token) => !remote.has(token) && unregisteredCategories.has(token))) {
    return null;
  }

  for (const token of removed) remote.delete(token);
  for (const token of added) remote.add(token);
  return [...remote].join(',');
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
 * - カテゴリは追加・削除した分だけを最新の集合に反映する。親の削除と子の追加は衝突させる
 * - 全行と登録簿から消えた名前の削除は、最新の行に追加もあれば改名の可能性があるので止める
 * - それ以外は、両方が違う値に変えた項目だけを衝突として返す
 *
 * 行を丸ごと比べると、作者の表記揃えのような無関係な更新が 1 つ入っただけで、その行の保留は
 * 二度と反映できない。保留は再取得しても保留したときの行（ここでの `base`）を持ち続けるので、
 * 取得し直しても解けない。
 */
export function mergeAkyoEditFields(
  base: AkyoEditFields,
  mine: AkyoEditFields,
  theirs: AkyoEditFields,
  /** Names absent from both the CSV and registry at the revision being committed. */
  unregisteredCategories: ReadonlySet<string>,
): { merged: AkyoEditFields; conflicts: AkyoEditFieldName[] } {
  const merged = { ...theirs };
  const conflicts: AkyoEditFieldName[] = [];
  for (const key of EDIT_FIELD_NAMES) {
    if (sameEditField(key, mine[key], base[key])) continue;
    if (sameEditField(key, theirs[key], base[key]) || sameEditField(key, theirs[key], mine[key])) {
      merged[key] = mine[key];
    } else if (key === 'category') {
      const category = mergeCategories(base.category, mine.category, theirs.category, unregisteredCategories);
      if (category === null) conflicts.push(key);
      else merged.category = category;
    } else {
      conflicts.push(key);
    }
  }
  return { merged, conflicts };
}
