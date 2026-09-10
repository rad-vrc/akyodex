/**
 * One place for "what the admin screen currently believes each Akyo row is".
 *
 * 動かすのは 2 つだけ:
 * - この session が保存した行（サーバの返り値。ページを開いたときの初期データは KV/R2 経由で
 *   遅れているので、保存した行はそこへ上書きしないと古いまま残る）
 * - 明示的な再取得（/api/admin/catalog）。書き込み側が競合判定に使うのと同じ CSV
 *   スナップショットなので、内容をそのまま採用してよく、保存済みの記録も畳める
 *
 * かつては再取得が公開カタログ（KV/R2）を読んでいて、そちらは CSV より遅れるため
 * 「行が無い」が「まだ同期されていない」なのか「削除された」なのか区別できなかった。
 * 置き換えた版のスナップショットを持ち歩いて遅延を見分ける仕組みがあったが、遅れない
 * 情報源に切り替えたことで前提ごと不要になった。`CommittedRow.before` はその名残で、
 * 現状どの判定にも使っていない（畳むのは別 PR）。
 *
 * 再取得はスナップショットの head 時点しか語れない。取得を始めたあとに保存が通った場合は
 * 古い可能性があるので、その判定は呼び出し側（admin-tabs）が取得開始時点との前後で行う。
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

/**
 * 再取得の結果を共有カタログへ渡す口。
 *
 * `begin()` で取得開始時点の印を取り、`apply()` がその間に保存が入っていないかを見て採否を
 * 返す。false のときは取得結果が自分の保存より古い可能性があるので、呼び出し側は現在の
 * 表示と保留をそのまま保つこと（黙って採用すると保存が巻き戻る）。
 */
export interface AdminCatalogSync {
  /** 保存が通ったことを知らせる。実行中の取得より新しい状態になった、という印 */
  noteCommit: () => void;
  begin: () => number;
  apply: (rows: AkyoData[], token: number) => boolean;
}

/**
 * 取得開始から戻るまでに保存が入っていないかを見る口を作る。
 *
 * 数えている番号はこのクロージャの中だけにある。React の state に置くと更新が反映される
 * 前の値を読むし、ref に置くと「描画中に ref を読んだ」ことになる。守りたいのは
 * 「取得開始から応答までの間に保存が通ったか」だけなので、描画とは無関係でよい。
 */
export function createAdminCatalogSync(
  applySnapshot: (rows: AkyoData[]) => void,
): AdminCatalogSync {
  let commits = 0;
  return {
    noteCommit: () => {
      commits += 1;
    },
    begin: () => commits,
    apply: (rows, token) => {
      if (commits !== token) return false;
      applySnapshot(rows);
      return true;
    },
  };
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
 * 保存先の CSV スナップショット（/api/admin/catalog）を、そのまま採用する。
 *
 * 遅れる公開カタログと違い、これは書き込み側が競合判定に使うのと同じ内容なので、内容を
 * 選び直す余地が無い。他の人が変更前とまったく同じ内容へ戻していれば、それも取り込む。
 * 保存済みの記録は、この時点で残す理由が無くなるので畳む。
 *
 * ここで言えるのは「そのスナップショットの head 時点ではこうだった」まで。取得を始めた
 * あとに自分の保存が通っている場合は古い可能性があるので、**そのときはこの関数を呼ばない**
 * こと（呼び出し側が取得開始時点との前後を見て捨てる）。
 */
export function applyAdminSnapshot(
  rows: AkyoData[],
): { catalog: AkyoData[]; committed: Map<string, CommittedRow> } {
  return { catalog: [...rows], committed: new Map() };
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
