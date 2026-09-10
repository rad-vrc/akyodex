/**
 * API Route: 管理画面の再取得用カタログ
 * GET /api/admin/catalog
 * Returns: { success: true, head: string, count: number, data: AkyoData[] }
 *
 * 認証は既存の管理 API と同じセッション確認だけで、方式は変えていない。
 * 中身は admin-catalog-handler.ts にある。
 */

import { handleAdminCatalogRequest } from './admin-catalog-handler';
import { readAdminCatalogSnapshot } from '@/lib/admin-catalog-snapshot';
import { validateSession } from '@/lib/api-helpers';

export async function GET(): Promise<Response> {
  return handleAdminCatalogRequest({
    validateSession,
    readSnapshot: readAdminCatalogSnapshot,
  });
}
