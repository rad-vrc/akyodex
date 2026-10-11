import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as entry from './akyo-entry';
import * as images from './vrchat-world-image';
import { serveWorldThumbnail, type WorldThumbnailStore } from './world-thumbnail-cache';

const root = new URL('../../', import.meta.url);
const routeSource = readFileSync(new URL('src/app/api/vrc-world-image/route.ts', root), 'utf8');
const utilsSource = readFileSync(new URL('src/lib/vrchat-utils.ts', root), 'utf8');

function loadModule(source: string, dependencies: Record<string, unknown>, fetchFn: typeof fetch) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Request, Response, Headers, AbortController, AbortSignal, setTimeout, clearTimeout,
    fetch: fetchFn, console: { log() {}, warn() {}, error() {} },
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test('actual world route reads R2 first, refreshes current OGP versions, and leaves uploads untouched', async () => {
  let version = 7;
  let now = Date.UTC(2026, 9, 11);
  let stored: Awaited<ReturnType<WorldThumbnailStore['get']>> = null;
  const tasks: Array<() => Promise<void>> = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const store: WorldThumbnailStore = {
    async get(key) { assert.match(key, /world-thumbnails\/v1\/wrld_valid\/512\/avif$/); return stored; },
    async put(key, bytes, options) {
      assert.match(key, /world-thumbnails\/v1\//);
      const metadata = options.httpMetadata;
      stored = { etag: 'etag', size: bytes.byteLength,
        httpMetadata: metadata && 'contentType' in metadata ? { contentType: metadata.contentType } : undefined,
        customMetadata: options.customMetadata, arrayBuffer: async () => bytes.slice(0),
      };
      return {};
    },
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    assert.ok(init?.signal, 'the page and image must share the outer deadline');
    if (new URL(url).hostname === 'vrchat.com') {
      assert.equal((init as RequestInit & { next?: { revalidate: number } }).next?.revalidate, 0);
      return new Response(`<meta property="og:image" content="https://api.vrchat.cloud/api/1/file/file_test/${version}/file">`);
    }
    assert.equal(url, `https://api.vrchat.cloud/api/1/image/file_test/${version}/512`);
    return new Response(`version-${version}`, { headers: { 'Content-Type': 'image/avif', 'Cf-Resized': 'internal=ok' } });
  };
  const utils = loadModule(utilsSource, { './akyo-entry': entry }, fetchFn);
  const GET = loadModule(routeSource, {
    'next/server': { connection: async () => {}, after: (task: () => Promise<void>) => tasks.push(task) },
    '@opennextjs/cloudflare': { getCloudflareContext: () => ({ env: {
      NEXT_INC_CACHE_R2_BUCKET: store,
      AKYO_BUCKET: { get() { assert.fail('registration-time image must not be read'); }, put() { assert.fail('uploads must not be overwritten'); } },
    } }) },
    '@/lib/api-helpers': { jsonError: (error: string, status: number) => Response.json({ error }, { status }),
      getApiErrorResponse: () => Response.json({ error: 'upstream' }, { status: 502 }) },
    '@/lib/akyo-entry': entry, '@/lib/vrchat-utils': utils,
    '@/lib/vrchat-world-image': { ...images,
      fetchVRChatWorldImageWithFallback: (args: Parameters<typeof images.fetchVRChatWorldImageWithFallback>[0]) =>
        images.fetchVRChatWorldImageWithFallback({ ...args, fetchFn }),
    },
    '@/lib/world-thumbnail-cache': { serveWorldThumbnail: (args: Parameters<typeof serveWorldThumbnail>[0]) =>
      serveWorldThumbnail({ ...args, now: () => now }) },
  }, fetchFn).GET as (request: Request) => Promise<Response>;
  const request = () => new Request('https://akyodex.com/api/vrc-world-image?wrld=wrld_valid&w=501&unused=1', {
    headers: { Accept: 'image/avif,image/webp' },
  });
  assert.equal(await (await GET(request())).text(), 'version-7');
  assert.equal(calls.length, 2);
  await tasks.shift()!();
  assert.equal(await (await GET(request())).text(), 'version-7');
  assert.equal(calls.length, 2, 'warm cache must skip both upstream requests');
  version = 8;
  now += 6 * 3_600_000;
  assert.equal(await (await GET(request())).text(), 'version-7');
  assert.equal(calls.length, 2, 'stale response does not wait for VRChat');
  await tasks.shift()!();
  assert.equal(await (await GET(request())).text(), 'version-8');
  assert.equal(calls.length, 4);
  const invalid = await GET(new Request('https://akyodex.com/api/vrc-world-image?wrld=../invalid'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.length, 4);
});
