import openNextWorker from './worker.js';

const PREVIEW_ROBOTS_POLICY = 'noindex, nofollow, noarchive';
const SAFE_PREVIEW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// プレビューは全面read-only。Cloudflare Accessによるゲート（2026-09-01有効化）
// とは独立した、アプリ側の防御層として維持する。管理ログインPOSTの例外は
// 導入しない。Accessが無効化・誤設定された瞬間に、公開URLで本番パスワードの
// 総当たりを許すことになるため（#473の事故：Access保護下だと未確認のまま
// 例外を入れ、実際には無保護だった）。例外を再導入するなら先に
// (1)Access保護が有効であることの実測 (2)Preview専用パスワード/SESSION_SECRET
// (3)ログインのレート制限 を整えること。

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
