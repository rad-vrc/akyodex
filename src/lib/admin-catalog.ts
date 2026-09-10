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
 *
 * その記録は、公開 JSON が追いついた後も捨てない。保存結果と一致する応答を一度取得しても、
 * その後の応答が新しいとは限らないからで、捨てると次の再取得が古い応答を返したときに前の版を
 * 「誰かの編集」として受け入れ、付けたばかりのカテゴリが画面から消える。
 *
 * 変更前と完全に同じ内容へ戻す外部更新は、この観測からは同期遅延と区別できない（自分が
 * B へ保存 → B を取得 → 他者が A へ戻す → A を取得、は遅れた A を掴んだ場合と同じ列になる）。
 * どちらか選ぶしかないので、記録が残っている間は自分の保存結果を優先する。取り違えたまま
 * 上書きへ進むことはない: サーバ側が送信された `original` を現在の CSV と照合し、食い違えば
 * 409 で止める。
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
    if (sameAkyoEditFields(getAkyoEditFields(entry.data), fields)) {
      // 追いついた。ただし記録は持ち続ける。一致する応答を一度取得しても、その後の応答が
      // 新しいとは限らず、捨てると次に古い応答を掴んだとき前の版を「誰かの編集」と読んで
      // しまう。変更前と完全に同じ内容への外部更新はここでは遅延と区別できないので、
      // 記録が残る間は自分の保存結果を優先する（詳細はファイル冒頭）
      nextCommitted.set(remote.id, entry);
      return remote;
    }
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
 * Category column changes, so the rows are patched instead of refetched — but the result is
 * recorded exactly like any other commit, or the next refresh from the lagging JSON would
 * read the pre-change category as somebody else's edit and undo the rename on screen.
 */
export function applyCategoryRowChanges(
  catalog: AkyoData[],
  committed: CommittedRows,
  changes: CategoryRowChange[],
): { catalog: AkyoData[]; committed: Map<string, CommittedRow> } {
  if (changes.length === 0) return { catalog, committed: new Map(committed) };
  const byId = new Map(changes.map((change) => [change.id, change.category]));
  const rows: AkyoData[] = [];
  const originals: AkyoEditFields[] = [];
  for (const row of catalog) {
    const category = byId.get(row.id);
    if (category === undefined) continue;
    originals.push(getAkyoEditFields(row));
    rows.push({ ...row, category, attribute: category });
  }
  return recordCommittedRows(catalog, committed, rows, originals);
}
