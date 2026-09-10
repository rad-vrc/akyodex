/**
 * Bulk assignment of categories to Akyo (admin "Categories" tab, phase 3).
 *
 * The admin picks a set S of categories (AND) and a direction. An Akyo is "selected" when it
 * carries every token in S. Attaching gives an Akyo the missing tokens of S together with
 * their ancestors (a child implies its parent); detaching takes every token of S away
 * together with its descendants (removing a parent removes its children).
 * Changes are staged as the same PendingAkyoUpdate the edit tab commits in one batch.
 *
 * **方向はカードの状態ではなくモードで決まる。** 以前は 1 クリックのトグルで、既に持って
 * いる Akyo を押すと外れた。既に持っているカードは最初から選択状態で表示されるので、
 * 自分でいま選んだカードと見分けが付かず、付ける作業の途中で押すと警告も無く外れて、
 * 外れたことにも気づけなかった（2026-09-10、#0926 が対応機種/PC を失った）。
 */

import { getAkyoEditFields, sameAkyoEditFields, type PendingAkyoUpdate } from './akyo-edit-fields';
import { isSelfOrDescendant, splitCategoryCell, withAncestors } from './category-operations';
import type { AkyoData } from '@/types/akyo';

/** 付ける（既定）か、外すか。押したカードの状態では決めない */
export type CategoryAssignMode = 'attach' | 'detach';

export function hasAllCategories(tokens: string[], selected: string[]): boolean {
  return selected.length > 0 && selected.every((path) => tokens.includes(path));
}

export function applyCategories(
  tokens: string[],
  selected: string[],
  mode: CategoryAssignMode,
): string[] {
  if (selected.length === 0) return tokens;
  if (mode === 'detach') {
    return tokens.filter((token) => !selected.some((path) => isSelfOrDescendant(token, path)));
  }
  return withAncestors([...tokens, ...selected]);
}

/** そのモードで、この Akyo は実際に変わるか。変わらないカードは押させない */
export function changesUnderMode(
  tokens: string[],
  selected: string[],
  mode: CategoryAssignMode,
): boolean {
  const next = applyCategories(tokens, selected, mode);
  return next.length !== tokens.length || next.some((token, index) => token !== tokens[index]);
}

export function categoriesOf(akyo: AkyoData): string[] {
  return splitCategoryCell(akyo.category || akyo.attribute || '');
}

/**
 * Stage the next category list for an Akyo. Returns null when the result equals the
 * original (the pending entry should be dropped), otherwise the pending update to keep.
 */
export function stageCategoryUpdate(
  base: AkyoData,
  previous: PendingAkyoUpdate | undefined,
  nextTokens: string[],
): PendingAkyoUpdate | null {
  const original = previous?.original ?? getAkyoEditFields(base);
  const changes = { ...original, category: nextTokens.join(',') };
  return sameAkyoEditFields(original, changes) ? null : { original, changes };
}
