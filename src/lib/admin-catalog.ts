/**
 * One place for "what the admin screen currently believes each Akyo row is".
 *
 * Three things fight over that answer:
 * - rows this session committed (the server's own reply, the freshest truth we have),
 * - a catalog refresh, which reads the public JSON and lags behind the CSV until the sync
 *   workflow runs, so it can hand back the pre-commit version of a row we just wrote,
 * - edits made elsewhere, which must be taken even though they overwrite our committed row.
 *
 * Keeping the committed rows together with the field snapshots they replaced tells those
 * apart: a refresh that returns one of those snapshots is stale, anything else is news.
 */

import { getAkyoEditFields, sameAkyoEditFields, type AkyoEditFields } from './akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

export interface CommittedRow {
  /** The row as the server saved it. */
  data: AkyoData;
  /** Field snapshots this row replaced; consecutive saves can land before the JSON updates. */
  before: AkyoEditFields[];
}

export type CommittedRows = ReadonlyMap<string, CommittedRow>;

export interface CategoryRowChange {
  id: string;
  category: string;
}

/** Merge saved rows into the catalog and remember what they replaced. */
export function recordCommittedRows(
  catalog: AkyoData[],
  committed: CommittedRows,
  rows: AkyoData[],
  originals: AkyoEditFields[],
): { catalog: AkyoData[]; committed: Map<string, CommittedRow> } {
  const originalById = new Map(originals.map((fields) => [fields.id, fields]));
  const nextCommitted = new Map(committed);
  const saved = new Map<string, AkyoData>();
  for (const row of rows) {
    const previous = nextCommitted.get(row.id);
    const original = originalById.get(row.id);
    nextCommitted.set(row.id, {
      data: row,
      before: [...(previous?.before ?? []), ...(original ? [original] : [])],
    });
    saved.set(row.id, row);
  }
  const merged = catalog.map((row) => saved.get(row.id) ?? row);
  for (const row of rows) if (!catalog.some((entry) => entry.id === row.id)) merged.push(row);
  return { catalog: merged, committed: nextCommitted };
}

/**
 * Take a freshly fetched catalog, keeping rows this session committed whenever the fetch
 * returned a version they already replaced.
 */
export function applyCatalogRefresh(
  incoming: AkyoData[],
  committed: CommittedRows,
): { catalog: AkyoData[]; committed: Map<string, CommittedRow> } {
  const nextCommitted = new Map<string, CommittedRow>();
  const catalog = incoming.map((remote) => {
    const entry = committed.get(remote.id);
    if (!entry) return remote;
    const fields = getAkyoEditFields(remote);
    if (sameAkyoEditFields(getAkyoEditFields(entry.data), fields)) return remote; // caught up
    if (entry.before.some((before) => sameAkyoEditFields(before, fields))) {
      // The fetch is behind our own commit: keep what the server saved and stay watchful.
      nextCommitted.set(remote.id, entry);
      return entry.data;
    }
    return remote; // someone else changed the row; their version wins
  });
  return { catalog, committed: nextCommitted };
}

/**
 * Apply the category rewrites a rename, merge or delete performed on the CSV. Only the
 * Category column changes, so the rows are patched in place instead of refetched.
 */
export function applyCategoryRowChanges(
  catalog: AkyoData[],
  committed: CommittedRows,
  changes: CategoryRowChange[],
): { catalog: AkyoData[]; committed: Map<string, CommittedRow> } {
  if (changes.length === 0) return { catalog, committed: new Map(committed) };
  const byId = new Map(changes.map((change) => [change.id, change.category]));
  const patch = (row: AkyoData): AkyoData => {
    const category = byId.get(row.id);
    return category === undefined ? row : { ...row, category, attribute: category };
  };
  const nextCommitted = new Map<string, CommittedRow>();
  for (const [id, entry] of committed) {
    nextCommitted.set(id, byId.has(id) ? { ...entry, data: patch(entry.data) } : entry);
  }
  return { catalog: catalog.map(patch), committed: nextCommitted };
}
