/**
 * 管理画面の再取得が読むカタログの本体。ルートから依存を渡して、認証と取得を差し替えられる
 * ようにしてある（`src/app/api/catalog/catalog-handler.ts` と同じ形）。
 *
 * 公開カタログ（/api/catalog/{lang}）ではなく、書き込み側と同じ CSV スナップショットを
 * 返す。遅れないので「行が無い＝その head には存在しない」と読める。
 */

import { jsonError } from '@/lib/api-helpers';

import type { AdminCatalogSnapshot } from '@/lib/admin-catalog-snapshot';

/**
 * 認証済みの応答なので共有キャッシュに載せない。再取得で古い応答を掴ませない。
 * 成功も失敗も同じ扱いにする（401 が中間キャッシュに残ると、ログイン後も弾かれ続ける）
 */
export const ADMIN_CATALOG_NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' } as const;

export interface AdminCatalogHandlerDependencies {
  /** セッションが無ければ falsy を返す。方式は既存の管理 API と同じ */
  validateSession: () => Promise<unknown>;
  readSnapshot: () => Promise<AdminCatalogSnapshot>;
}

export async function handleAdminCatalogRequest(
  dependencies: AdminCatalogHandlerDependencies,
): Promise<Response> {
  const session = await dependencies.validateSession();
  if (!session) return jsonError('認証が必要です', 401, {}, ADMIN_CATALOG_NO_STORE);

  try {
    const { head, rows } = await dependencies.readSnapshot();
    return Response.json(
      { success: true, head, count: rows.length, data: rows },
      { headers: ADMIN_CATALOG_NO_STORE },
    );
  } catch (error) {
    // 取得も解析も、失敗を空配列で返さない。呼び出し側は現在の一覧と保留を保つ
    console.error('[admin/catalog] snapshot read failed:', error);
    return jsonError('保存先の最新データを取得できませんでした。', 502, {}, ADMIN_CATALOG_NO_STORE);
  }
}
