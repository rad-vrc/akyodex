/**
 * API Route: 管理画面の再取得用カタログ
 * GET /api/admin/catalog
 * Returns: { success: true, head: string, count: number, data: AkyoData[] }
 *
 * 公開カタログ（/api/catalog/{lang}）ではなく、書き込み側と同じ CSV スナップショットを
 * 返す。遅れないので「行が無い＝その head には存在しない」と読める。
 *
 * 認証は既存の管理 API と同じセッション確認だけで、方式は変えていない。
 */

import { jsonError, validateSession } from '@/lib/api-helpers';
import { readAdminCatalogSnapshot } from '@/lib/admin-catalog-snapshot';

/** 認証済みの応答なので共有キャッシュに載せない。再取得で古い応答を掴ませない */
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' } as const;

export async function GET(): Promise<Response> {
  const session = await validateSession();
  if (!session) return jsonError('認証が必要です', 401, {}, NO_STORE);

  try {
    const { head, rows } = await readAdminCatalogSnapshot();
    return Response.json(
      { success: true, head, count: rows.length, data: rows },
      { headers: NO_STORE },
    );
  } catch (error) {
    // 取得も解析も、失敗を空配列で返さない。呼び出し側は現在の一覧と保留を保つ
    console.error('[admin/catalog] snapshot read failed:', error);
    return jsonError('保存先の最新データを取得できませんでした。', 502, {}, NO_STORE);
  }
}
