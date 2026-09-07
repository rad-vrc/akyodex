/**
 * Request handling for /api/categories, separated from the route for tests.
 */

import type { AdminRole } from '@/types/akyo';
import { jsonError } from './api-helpers';
import {
  CategoryOperationError,
  createCategory,
  deleteCategory,
  listChangedCategoryRows,
  mergeCategory,
  renameCategory,
  summarizeCategories,
  translateCategory,
  type CategoryChange,
  type CategoryDataset,
} from './category-operations';
import { commitCategoryChange, loadCategorySnapshot, type CategoryStoreDeps } from './category-store';
import { GitHubConflictError } from './github-utils';

export const CATEGORY_ACTIONS = ['create', 'translate', 'rename', 'merge', 'delete'] as const;
export type CategoryAction = (typeof CATEGORY_ACTIONS)[number];
/** Structural changes are the owner's call; adding a category or a translation is not. */
export const OWNER_ONLY_CATEGORY_ACTIONS: ReadonlySet<CategoryAction> = new Set(['rename', 'merge', 'delete']);

const CONFLICT_MESSAGE = '他の更新が先に入りました。一覧を再読み込みしてからやり直してください';
const STALE_LIST_MESSAGE = '一覧を表示してから他の更新が入りました。再読み込みして内容を確認してからやり直してください';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyCategoryAction(action: CategoryAction, dataset: CategoryDataset, body: Record<string, unknown>): CategoryChange {
  switch (action) {
    case 'create':
      return createCategory(dataset, { path: body.path, en: body.en, ko: body.ko, ancestors: body.ancestors });
    case 'translate':
      return translateCategory(dataset, { path: body.path, en: body.en, ko: body.ko });
    case 'rename':
      return renameCategory(dataset, { from: body.from, to: body.to, en: body.en, ko: body.ko });
    case 'merge':
      return mergeCategory(dataset, { from: body.from, into: body.into });
    case 'delete':
      return deleteCategory(dataset, { path: body.path });
  }
}

function successMessage(action: CategoryAction, body: Record<string, unknown>, changedRows: number): string {
  const rows = changedRows > 0 ? `（${changedRows} 件の Akyo を更新）` : '';
  switch (action) {
    case 'create': {
      // 親階層もまとめて作った場合は、何が増えたのかを画面に出す
      const created = Array.isArray(body.ancestors) ? body.ancestors.length : 0;
      const parents = created > 0 ? `（親階層 ${created} 件も作成）` : '';
      return `カテゴリ「${String(body.path)}」を作成しました${parents}`;
    }
    case 'translate':
      return `カテゴリ「${String(body.path)}」の対訳を更新しました`;
    case 'rename':
      return body.from === body.to
        ? `カテゴリ「${String(body.to)}」の対訳を更新しました`
        : `カテゴリ「${String(body.from)}」を「${String(body.to)}」に変更しました${rows}`;
    case 'merge':
      return `カテゴリ「${String(body.from)}」を「${String(body.into)}」に統合しました${rows}`;
    case 'delete':
      return `カテゴリ「${String(body.path)}」を削除しました${rows}`;
  }
}

export async function buildCategoryListResponse(deps?: CategoryStoreDeps): Promise<Response> {
  try {
    const snapshot = await loadCategorySnapshot(deps);
    return Response.json({
      success: true,
      head: snapshot.head,
      categories: summarizeCategories(snapshot.dataset),
      colors: snapshot.dataset.colors,
    });
  } catch (error) {
    if (error instanceof CategoryOperationError) return jsonError(error.message, error.status);
    console.error('[categories] Failed to load:', error);
    return jsonError('カテゴリ一覧を取得できませんでした', 500);
  }
}

export async function processCategoryRequest(
  body: unknown,
  role: AdminRole,
  deps?: CategoryStoreDeps,
): Promise<Response> {
  if (!isRecord(body) || typeof body.action !== 'string') {
    return jsonError('リクエスト形式が不正です', 400);
  }
  const action = body.action as CategoryAction;
  if (!CATEGORY_ACTIONS.includes(action)) {
    return jsonError('不明な操作です', 400);
  }
  if (OWNER_ONLY_CATEGORY_ACTIONS.has(action) && role !== 'owner') {
    return jsonError('カテゴリの改名・統合・削除はらど（上位管理者）のみ使用できます', 403);
  }
  // The non-force ref update only guards the window inside this request. `head` is the
  // commit the list was read from, so a rename decided on a stale screen cannot overwrite
  // what someone else changed in between. `create` may omit it (the attribute modal has no
  // list); it adds a key that a fresh snapshot already checks for duplicates.
  if (action !== 'create' && typeof body.head !== 'string') {
    return jsonError('一覧の版（head）がありません。一覧を再読み込みしてください', 400);
  }
  try {
    const snapshot = await loadCategorySnapshot(deps);
    if (typeof body.head === 'string' && body.head !== snapshot.head) {
      return jsonError(STALE_LIST_MESSAGE, 409, { head: snapshot.head });
    }
    const change = applyCategoryAction(action, snapshot.dataset, body);
    const commit = await commitCategoryChange(snapshot, change, deps);
    return Response.json({
      success: true,
      message: successMessage(action, body, change.changedRows),
      changedRows: change.changedRows,
      // The rows this rewrote, so the admin screen can follow without refetching the catalog.
      updatedRows: listChangedCategoryRows(snapshot.dataset, change.dataset),
      commitUrl: commit.commit.html_url,
      head: commit.sha,
      files: commit.files,
    });
  } catch (error) {
    if (error instanceof CategoryOperationError) return jsonError(error.message, error.status);
    if (error instanceof GitHubConflictError) return jsonError(CONFLICT_MESSAGE, 409);
    console.error('[categories] Failed:', error);
    return jsonError('カテゴリの更新に失敗しました。コミット状況を確認してから再試行してください', 500);
  }
}
