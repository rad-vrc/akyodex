import openNextWorker from './worker.js';

const PREVIEW_ROBOTS_POLICY = 'noindex, nofollow, noarchive';
const SAFE_PREVIEW_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isReadOnlyPreview(env) {
  return env.PAGES_PREVIEW_READ_ONLY === 'true';
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

    if (
      readOnlyPreview &&
      !SAFE_PREVIEW_METHODS.has(request.method.toUpperCase())
    ) {
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
