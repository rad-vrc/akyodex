/**
 * 管理画面の「データを再取得」が読む、保存先そのもののスナップショット。
 *
 * 公開カタログ（/api/catalog/{lang}）は KV/R2 経由で、管理画面が書いた CSV より遅れる。
 * その遅れの中では「行が無い」が「まだ同期されていない」なのか「削除された」なのか
 * 区別できない。書き込み側（akyo-batch-update.ts）が競合判定に使っているのと同じ
 * `loadAkyoCsvSnapshot` を読めば、返ってくるのは保存先そのものなので区別できる。
 *
 * ただし言えるのは **その head の時点の内容** まで。取得を始めたあとに保存が通れば、
 * 正しい CSV でも画面が持っている保存結果より古い。head を返すのはどの版を読んだかを
 * 追えるようにするためで、head だけで新旧が決まるわけではない。呼び出し側は自分の
 * 保存との前後関係を別に持つこと。
 */

import { stringify } from 'csv-stringify/sync';

import { loadAkyoCsvSnapshot, type AkyoCsvSnapshot } from './akyo-csv-snapshot';
import { parseCsvToAkyoData } from './csv-utils';

import type { AkyoData } from '@/types/akyo';

export interface AdminCatalogSnapshot {
  /** 読み取り元のコミット。どの版かを追うためのもので、新旧判定には使わない */
  head: string;
  rows: AkyoData[];
}

/**
 * 失敗は必ず例外にする。空配列を「成功」として返すと、呼び出し側がそれを完全な
 * スナップショットとして扱い、画面から全行を消す。
 */
export async function readAdminCatalogSnapshot(
  loadSnapshot: () => Promise<AkyoCsvSnapshot> = loadAkyoCsvSnapshot,
): Promise<AdminCatalogSnapshot> {
  const { head, header, dataRecords } = await loadSnapshot();
  const rows = parseCsvToAkyoData(stringify([header, ...dataRecords]));
  if (rows.length === 0) {
    throw new Error('保存先の CSV から 1 行も読み取れませんでした');
  }
  if (rows.length !== dataRecords.length) {
    throw new Error(`CSV の行数と解析結果が一致しません（${dataRecords.length} 行 → ${rows.length} 件）`);
  }
  // parseCsvToAkyoData は ID の無い行も落とさずに返す。ID が空のまま渡すと、画面側の
  // 保留・ブロック・ハイライトが全部 ID で引くので、無関係な行に紐づいて見える
  if (rows.some((row) => !row.id)) {
    throw new Error('保存先の CSV に ID の無い行があります');
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error('保存先の CSV に ID の重複があります');
  }
  return { head, rows };
}
