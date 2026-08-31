import openNextWorker from './worker.js';

const PREVIEW_ROBOTS_POLICY = 'noindex, nofollow, noarchive';
const SAFE_PREVIEW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// プレビューは全面read-only（安全側の既定）。管理ログインPOSTの例外は、
// PagesプレビューがCloudflare Accessで保護されていない前提では、公開URLで
// 本番パスワードの総当たりを許すため導入しない。管理UIをプレビューで
// 確認したい場合は先に(1)Access policy有効化 (2)Preview専用パスワード/
// SESSION_SECRET (3)ログインのレート制限 を整えてから例外を再導入すること。

function isReadOnlyPreview(env) {
  return env.PAGES_PREVIEW_READ_ONLY === 'true';
}

function isPreviewAllowedRequest(request) {
  return SAFE_PREVIEW_METHODS.has(request.method.toUpperCase());
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
