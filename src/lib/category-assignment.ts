/**
 * Bulk assignment of categories to Akyo (admin "Categories" tab, phase 3).
 *
 * The admin picks a set S of categories (AND). An Akyo is "selected" when it carries every
 * token in S. Clicking a card toggles: a selected Akyo loses every token of S together with
 * its descendants (removing a parent removes its children); any other Akyo gains the
 * missing tokens of S together with their ancestors (a child implies its parent).
 * Changes are staged as the same PendingAkyoUpdate the edit tab commits in one batch.
 */

import { getAkyoEditFields, sameAkyoEditFields, type PendingAkyoUpdate } from './akyo-edit-fields';
import { isSelfOrDescendant, splitCategoryCell, withAncestors } from './category-operations';
import type { AkyoData } from '@/types/akyo';

export function hasAllCategories(tokens: string[], selected: string[]): boolean {
  return selected.length > 0 && selected.every((path) => tokens.includes(path));
}

export function toggleCategories(tokens: string[], selected: string[]): string[] {
  if (selected.length === 0) return tokens;
  if (hasAllCategories(tokens, selected)) {
    return tokens.filter((token) => !selected.some((path) => isSelfOrDescendant(token, path)));
  }
  return withAncestors([...tokens, ...selected]);
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
