import assert from 'node:assert/strict';
import test from 'node:test';

import * as vrchatWorldImageModuleNs from './vrchat-world-image';

const vrchatWorldImageModule =
  (vrchatWorldImageModuleNs as { default?: Record<string, unknown> }).default ??
  (vrchatWorldImageModuleNs as Record<string, unknown>);

const getSizedVRChatWorldImageUrl = vrchatWorldImageModule.getSizedVRChatWorldImageUrl as
  | ((imageUrl: string, width: number) => string)
  | undefined;
const normalizeVRChatImageWidth = vrchatWorldImageModule.normalizeVRChatImageWidth as
  | ((value: string | null | undefined) => number)
  | undefined;
const snapVRChatImageWidth = vrchatWorldImageModule.snapVRChatImageWidth as
  | ((value: string | number | null | undefined) => number)
  | undefined;
const getVRChatWorldImageRequestParams = vrchatWorldImageModule.getVRChatWorldImageRequestParams as
  | ((requestUrl: string) => { wrld: string | null; width: number })
  | undefined;
const resolveVRChatWorldImageUrlFromHtml =
  vrchatWorldImageModule.resolveVRChatWorldImageUrlFromHtml as
  | ((html: string, width: number) => string)
  | undefined;
const getPreferredCloudflareImageFormat =
  vrchatWorldImageModule.getPreferredCloudflareImageFormat as
  | ((accept: string | null) => 'avif' | 'webp' | null)
  | undefined;
const createVRChatWorldImageFetchInit =
  vrchatWorldImageModule.createVRChatWorldImageFetchInit as
  | ((args: {
      width: number;
      format: 'avif' | 'webp' | null;
      signal: AbortSignal;
    }) => RequestInit & {
      cf?: {
        image?: {
          width?: number;
          fit?: string;
          quality?: number;
          format?: string;
        };
      };
    })
  | undefined;
const fetchVRChatWorldImageWithFallback =
  vrchatWorldImageModule.fetchVRChatWorldImageWithFallback as
  | ((args: {
      imageUrl: string;
      width: number;
      format: 'avif' | 'webp' | null;
      fetchFn: typeof fetch;
      timeoutMs?: number;
    }) => Promise<{ response: Response; transformed: boolean }>)
  | undefined;
const getVRChatWorldImageResponseHeaders =
  vrchatWorldImageModule.getVRChatWorldImageResponseHeaders as
  | ((contentType: string) => Headers)
  | undefined;

test('normalizeVRChatImageWidth clamps world image widths like the avatar proxy', () => {
  assert.equal(typeof normalizeVRChatImageWidth, 'function');

  assert.equal(normalizeVRChatImageWidth?.('96'), 96);
  assert.equal(normalizeVRChatImageWidth?.('99999'), 4096);
  assert.equal(normalizeVRChatImageWidth?.('nope'), 512);
});

test('snapVRChatImageWidth limits public requests to known catalog sizes', () => {
  assert.equal(typeof snapVRChatImageWidth, 'function');

  assert.equal(snapVRChatImageWidth?.(32), 96);
  assert.equal(snapVRChatImageWidth?.(96), 96);
  assert.equal(snapVRChatImageWidth?.(511), 512);
  assert.equal(snapVRChatImageWidth?.(513), 512);
  assert.equal(snapVRChatImageWidth?.(777), 800);
  assert.equal(snapVRChatImageWidth?.(800), 800);
  assert.equal(snapVRChatImageWidth?.(1234), 1024);
  assert.equal(snapVRChatImageWidth?.(4096), 1024);
});

test('getSizedVRChatWorldImageUrl rewrites VRChat API image URLs to the requested width', () => {
  assert.equal(typeof getSizedVRChatWorldImageUrl, 'function');

  assert.equal(
    getSizedVRChatWorldImageUrl?.('https://api.vrchat.cloud/api/1/image/file_abc123/1/1200', 96),
    'https://api.vrchat.cloud/api/1/image/file_abc123/1/96'
  );
  assert.equal(
    getSizedVRChatWorldImageUrl?.(
      'https://files.vrchat.cloud/thumbnails/file_abc123/file_abc123.123.thumbnail-1200.png',
      256
    ),
    'https://api.vrchat.cloud/api/1/image/file_abc123/123/256'
  );
});

test('getSizedVRChatWorldImageUrl preserves file version from VRChat image URLs', () => {
  assert.equal(typeof getSizedVRChatWorldImageUrl, 'function');

  // api.vrchat.cloud image URL with version > 1 preserves that version
  assert.equal(
    getSizedVRChatWorldImageUrl?.('https://api.vrchat.cloud/api/1/image/file_abc123/3/512', 256),
    'https://api.vrchat.cloud/api/1/image/file_abc123/3/256'
  );

  // api.vrchat.cloud file URL preserves version
  assert.equal(
    getSizedVRChatWorldImageUrl?.(
      'https://api.vrchat.cloud/api/1/file/file_abc123/5/file',
      128
    ),
    'https://api.vrchat.cloud/api/1/image/file_abc123/5/128'
  );

  // files.vrchat.cloud thumbnail URL extracts version from filename
  assert.equal(
    getSizedVRChatWorldImageUrl?.(
      'https://files.vrchat.cloud/thumbnails/file_xyz/file_xyz.7.thumbnail-512.png',
      96
    ),
    'https://api.vrchat.cloud/api/1/image/file_xyz/7/96'
  );
});

test('getVRChatWorldImageRequestParams reads wrld and width from the route URL', () => {
  assert.equal(typeof getVRChatWorldImageRequestParams, 'function');

  assert.deepEqual(
    getVRChatWorldImageRequestParams?.(
      'https://example.com/api/vrc-world-image?wrld=wrld_abc&w=96'
    ),
    { wrld: 'wrld_abc', width: 96 }
  );
  assert.deepEqual(
    getVRChatWorldImageRequestParams?.(
      'https://example.com/api/vrc-world-image?wrld=wrld_abc&w=777'
    ),
    { wrld: 'wrld_abc', width: 800 }
  );
});

test('resolveVRChatWorldImageUrlFromHtml rewrites og:image through the width-aware helper', () => {
  assert.equal(typeof resolveVRChatWorldImageUrlFromHtml, 'function');

  const html =
    '<meta property="og:image" content="https://api.vrchat.cloud/api/1/image/file_abc123/1/1200">';

  assert.equal(
    resolveVRChatWorldImageUrlFromHtml?.(html, 96),
    'https://api.vrchat.cloud/api/1/image/file_abc123/1/96'
  );
});

test('resolveVRChatWorldImageUrlFromHtml keeps apostrophes inside double-quoted og:image', () => {
  assert.equal(typeof resolveVRChatWorldImageUrlFromHtml, 'function');

  const html =
    '<meta property="og:image" content="https://vrchat.com/og?title=Builder\'s+World">';

  assert.equal(
    resolveVRChatWorldImageUrlFromHtml?.(html, 96),
    "https://vrchat.com/og?title=Builder's+World"
  );
});

test('getPreferredCloudflareImageFormat prefers AVIF, then WebP, then the original format', () => {
  assert.equal(typeof getPreferredCloudflareImageFormat, 'function');

  assert.equal(
    getPreferredCloudflareImageFormat?.('image/webp,image/avif,image/*'),
    'avif'
  );
  assert.equal(getPreferredCloudflareImageFormat?.('image/webp,image/*'), 'webp');
  assert.equal(getPreferredCloudflareImageFormat?.('image/png,image/*'), null);
  assert.equal(getPreferredCloudflareImageFormat?.(null), null);
});

test('getPreferredCloudflareImageFormat honors Accept quality values', () => {
  assert.equal(typeof getPreferredCloudflareImageFormat, 'function');

  assert.equal(
    getPreferredCloudflareImageFormat?.('image/avif;q=0,image/webp;q=1'),
    'webp'
  );
  assert.equal(
    getPreferredCloudflareImageFormat?.('image/avif;q=0.2,image/webp;q=0.8'),
    'webp'
  );
  assert.equal(
    getPreferredCloudflareImageFormat?.('image/avif;q=0,image/webp;q=0'),
    null
  );
});

test('createVRChatWorldImageFetchInit applies the Cloudflare image transformation', () => {
  assert.equal(typeof createVRChatWorldImageFetchInit, 'function');

  const controller = new AbortController();
  const init = createVRChatWorldImageFetchInit?.({
    width: 512,
    format: 'avif',
    signal: controller.signal,
  });

  assert.deepEqual(init?.cf?.image, {
    width: 512,
    fit: 'scale-down',
    quality: 80,
    format: 'avif',
  });
  assert.equal(init?.signal, controller.signal);

  const snappedInit = createVRChatWorldImageFetchInit?.({
    width: 777,
    format: 'webp',
    signal: controller.signal,
  });
  assert.equal(snappedInit?.cf?.image?.width, 800);
});

test('fetchVRChatWorldImageWithFallback accepts only a confirmed transformed response', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  let callCount = 0;
  const fetchFn = (async () => {
    callCount += 1;
    return new Response('transformed image', {
      status: 200,
      headers: {
        'Content-Type': 'image/avif',
        'Cf-Resized': 'width=512',
      },
    });
  }) as typeof fetch;

  const result = await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: 'avif',
    fetchFn,
  });

  assert.equal(callCount, 1);
  assert.equal(result?.transformed, true);
});

test('fetchVRChatWorldImageWithFallback retries a silently ignored transformation', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  let callCount = 0;
  const fetchFn = (async () => {
    callCount += 1;
    return new Response(callCount === 1 ? 'untransformed image' : 'original image', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  const result = await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: 'avif',
    fetchFn,
  });

  assert.equal(callCount, 2);
  assert.equal(result?.transformed, false);
  assert.equal(result?.response.headers.get('Content-Type'), 'image/png');
});

test('fetchVRChatWorldImageWithFallback retries without Cloudflare transformation', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  const calls: Array<RequestInit | undefined> = [];
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    if (calls.length === 1) {
      return new Response('transform unavailable', { status: 500 });
    }
    return new Response('original image', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  const result = await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: 'webp',
    fetchFn,
  });

  assert.equal(calls.length, 2);
  assert.ok('cf' in (calls[0] ?? {}));
  assert.equal('cf' in (calls[1] ?? {}), false);
  assert.equal(result?.response.status, 200);
  assert.equal(result?.transformed, false);
});

test('fetchVRChatWorldImageWithFallback cancels a rejected transform response body', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  let bodyCancelled = false;
  let callCount = 0;
  const rejectedBody = new ReadableStream({
    cancel() {
      bodyCancelled = true;
    },
  });
  const fetchFn = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(rejectedBody, { status: 500 });
    }
    return new Response('original image', { status: 200 });
  }) as typeof fetch;

  await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: 'webp',
    fetchFn,
  });

  assert.equal(bodyCancelled, true);
});

test('fetchVRChatWorldImageWithFallback skips transformation for unsupported clients', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  const calls: Array<RequestInit | undefined> = [];
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    return new Response('original image', { status: 200 });
  }) as typeof fetch;

  const result = await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: null,
    fetchFn,
  });

  assert.equal(calls.length, 1);
  assert.equal('cf' in (calls[0] ?? {}), false);
  assert.equal(result?.transformed, false);
});

test('fetchVRChatWorldImageWithFallback retries the original after a transform timeout', async () => {
  assert.equal(typeof fetchVRChatWorldImageWithFallback, 'function');

  let callCount = 0;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    }
    return new Response('original image', { status: 200 });
  }) as typeof fetch;

  const result = await fetchVRChatWorldImageWithFallback?.({
    imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
    width: 512,
    format: 'avif',
    fetchFn,
    timeoutMs: 5,
  });

  assert.equal(callCount, 2);
  assert.equal(result?.response.status, 200);
  assert.equal(result?.transformed, false);
});

test('fetchVRChatWorldImageWithFallback shares one timeout budget across both attempts', async () => {
  assert.ok(fetchVRChatWorldImageWithFallback);

  let callCount = 0;
  const startedAt = performance.now();
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response('transform unavailable', { status: 500 });
    }
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      );
    });
  }) as typeof fetch;

  await assert.rejects(
    fetchVRChatWorldImageWithFallback({
      imageUrl: 'https://api.vrchat.cloud/api/1/image/file_test/1/512',
      width: 512,
      format: 'avif',
      fetchFn,
      timeoutMs: 80,
    }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
  );
  assert.ok(performance.now() - startedAt < 110);
  assert.equal(callCount, 2);
});

test('getVRChatWorldImageResponseHeaders varies by Accept and applies the long cache policy', () => {
  assert.equal(typeof getVRChatWorldImageResponseHeaders, 'function');

  const headers = getVRChatWorldImageResponseHeaders?.('image/avif');

  assert.equal(headers?.get('Content-Type'), 'image/avif');
  assert.equal(headers?.get('Vary'), 'Accept');
  assert.equal(
    headers?.get('Cache-Control'),
    'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000'
  );
  assert.equal(headers?.get('X-Image-Source'), 'vrchat-world-ogp');
});
