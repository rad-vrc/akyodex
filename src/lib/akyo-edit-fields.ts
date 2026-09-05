import type { AkyoData } from '@/types/akyo';
import { getAkyoSourceUrl, normalizeVrchatSourceUrl } from './akyo-entry';

export const MAX_BATCH_UPDATES = 100;

export const EDIT_FIELD_NAMES = [
  'id', 'entryType', 'displaySerial', 'nickname', 'avatarName', 'author',
  'sourceUrl', 'boothUrl', 'category', 'comment',
] as const;

export type AkyoEditFields = Record<typeof EDIT_FIELD_NAMES[number], string>;
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

export function sameAkyoEditFields(a: AkyoEditFields, b: AkyoEditFields): boolean {
  // CSV -> JSON inserts category ancestors and normalizes line endings.
  // Compare the same representation without changing the submitted values.
  const comparable = (key: typeof EDIT_FIELD_NAMES[number], value: string) => {
    if (key === 'comment') return value.replace(/\r\n?/g, '\n');
    if (key !== 'category') return value;
    return [...new Set(value.split(',').map((token) => token.trim()).filter(Boolean).flatMap((token) => {
      const parts = token.split('/');
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    }))].join(',');
  };
  return EDIT_FIELD_NAMES.every((key) => comparable(key, a[key]) === comparable(key, b[key]));
}
