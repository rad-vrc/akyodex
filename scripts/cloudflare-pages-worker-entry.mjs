import openNextWorker from './worker.js';

const PREVIEW_ROBOTS_POLICY = 'noindex, nofollow, noarchive';
const SAFE_PREVIEW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// 認証セッションの確立/破棄のPOSTだけはプレビューでも通す（管理UIの表示確認用。
// パスワード等はPagesプロジェクトのPreview環境シークレットで供給される）。
// データを変更するAPI群（upload/update/delete/csv等）は引き続き全ブロック。
const PREVIEW_AUTH_POST_PATHS = new Set(['/api/admin/login', '/api/admin/logout']);

function isReadOnlyPreview(env) {
  return env.PAGES_PREVIEW_READ_ONLY === 'true';
}

function isPreviewAllowedRequest(request) {
  const method = request.method.toUpperCase();
  if (SAFE_PREVIEW_METHODS.has(method)) {
    return true;
  }
  if (method === 'POST') {
    return PREVIEW_AUTH_POST_PATHS.has(new URL(request.url).pathname);
  }
  return false;
}

function withPreviewHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', PREVIEW_ROBOTS_POLICY);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, context) {
    const readOnlyPreview = isReadOnlyPreview(env);

    if (readOnlyPreview && !isPreviewAllowedRequest(request)) {
      return new Response('Cloudflare Pages previews are read-only.', {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Robots-Tag': PREVIEW_ROBOTS_POLICY,
        },
      });
    }

    const response = await openNextWorker.fetch(request, env, context);
    return readOnlyPreview ? withPreviewHeaders(response) : response;
  },
};
