/**
 * 完全版カタログの取り直しを判断する純粋な部分。
 *
 * /zukan のフィルターは完全版カタログが届くまで描画されない（`zukan-client.tsx`）。
 * 取得が中断されたまま後続が始まらないと、フィルターはスピナーのまま戻らず、
 * 画面にもエラーが出ないので利用者には打つ手が無い。bfcache からの復帰と
 * タブの復帰を合図に、止まっていたら取り直す。
 */

/**
 * 自動の取り直しの下限間隔。取得元が落ちている間にタブを行き来されると、
 * 復帰のたびに投げ直して Sentry も埋めてしまうので間隔を空ける。
 * 利用者が押す再試行ボタンはこの制限を受けない
 */
export const CATALOG_RESUME_MIN_INTERVAL_MS = 30_000;

export type CatalogResumeTrigger =
  | { type: "pageshow"; persisted: boolean }
  | { type: "visibilitychange"; visibilityState: DocumentVisibilityState };

export interface CatalogResumeState {
  /** 完全版カタログが適用済みか。済んでいれば取り直す理由は無い */
  datasetComplete: boolean;
  /**
   * 進行中の取得が無い、または締切を過ぎても決着していない
   * （`CatalogRequestCoordinator.isStalled`）
   */
  stalled: boolean;
  /** 直近に自動で取り直してからの経過ミリ秒。一度も取り直していなければ `Infinity` */
  msSinceLastResume: number;
}

/**
 * 復帰の合図を受けて取り直すべきか。
 *
 * `pageshow` は bfcache から戻ったとき（`persisted`）だけを見る。通常の読み込みでも
 * 発火するが、そちらは初回の取得が走るので二重に投げない。
 * `visibilitychange` は表示に戻ったときだけ見る。隠れる側では何もしない。
 */
export function shouldResumeCatalogLoad(
  trigger: CatalogResumeTrigger,
  state: CatalogResumeState,
): boolean {
  if (state.datasetComplete) return false;
  if (!state.stalled) return false;
  if (state.msSinceLastResume < CATALOG_RESUME_MIN_INTERVAL_MS) return false;

  return trigger.type === "pageshow"
    ? trigger.persisted
    : trigger.visibilityState === "visible";
}
