import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as entry from './akyo-entry';
import { fetchVrchatResource } from './vrchat-resource-fetch';
import {
  createAvatarImageFailureResponse,
  fetchAvatarCardImageWithFallback,
  getAvatarCardImageResponseHeaders,
  getPreferredAvatarCardImageFormat,
  shouldTransformAvatarCardImage,
} from './avatar-card-image';
import { VRCHAT_USER_AGENT } from './vrchat-utils';
import type { AkyoData } from '../types/akyo';

const source = readFileSync(new URL('../app/api/avatar-image/route.ts', import.meta.url), 'utf8');

type AkyoLookup = (id: string) => Promise<AkyoData | null>;

function loadRoute(fetchFn: typeof fetch, getAkyoById: AkyoLookup = async () => null) {
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    'next/server': { connection: async () => {} },
    '@/lib/api-helpers': { jsonError: (error: string, status: number) => Response.json({ error }, { status }) },
    '@/lib/akyo-data': { getAkyoById },
    '@/lib/akyo-entry': entry,
    '@/lib/vrchat-utils': { VRCHAT_USER_AGENT },
    '@/lib/vrchat-resource-fetch': {
      fetchVrchatResource: (...args: Parameters<typeof fetchVrchatResource>) =>
        fetchVrchatResource(args[0], args[1], args[2], fetchFn),
    },
    '@/lib/avatar-card-image': {
      createAvatarImageFailureResponse,
      getAvatarCardImageResponseHeaders,
      getPreferredAvatarCardImageFormat,
      shouldTransformAvatarCardImage,
      // 実装はそのまま、fetch だけテスト側のものに差し替える
      fetchAvatarCardImageWithFallback: (args: Parameters<typeof fetchAvatarCardImageWithFallback>[0]) =>
        fetchAvatarCardImageWithFallback({ ...args, fetchFn }),
    },
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Request, Response, AbortController, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'production' } },
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchFn,
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports.GET!;
}

const imageUrl = 'https://api.vrchat.cloud/api/1/file/file_test/1/file';
const html = `<meta name="og:image" content="${imageUrl}">`;
const request = () => new Request('https://akyodex.com/api/avatar-image?avtr=avtr_valid');

for (const blocked of ['page', 'image', 'none']) {
  test(`actual avatar route enforces redirect policy (${blocked})`, async () => {
    const calls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const userAgents: Array<string | null> = [];
    const GET = loadRoute(async (url, init) => {
      calls.push(String(url));
      redirectModes.push(init?.redirect);
      userAgents.push(new Headers(init?.headers).get('User-Agent'));
      if (calls.length === 1) {
        return blocked === 'page'
          ? new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } })
          : new Response(html);
      }
      if (calls.length === 2) {
        return new Response(null, { status: 302, headers: {
          Location: blocked === 'image' ? 'https://evil.example/' : 'https://files.vrchat.cloud/image.png',
        } });
      }
      return new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } });
    });
    const response = await GET(request());
    assert.ok(redirectModes.every(mode => mode === 'manual'), 'every fetch must disable automatic redirects');
    assert.ok(userAgents.every(value => value === VRCHAT_USER_AGENT), 'every fetch must preserve the VRChat User-Agent');
    assert.equal(calls.length, blocked === 'page' ? 1 : blocked === 'image' ? 2 : 3);
    assert.ok(calls.every(url => new URL(url).hostname !== 'evil.example'));
    if (blocked === 'none') {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('X-Image-Source'), 'vrchat');
      assert.equal(await response.text(), 'image-bytes');
    } else {
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  });
}

// id だけで呼ばれたときの avtr は Akyo レコードから引く。以前は R2 の
// akyo-data/akyo-data-ja.csv を読んでいたが、そのファイルは R2 に無く常に 404 だった
test('id-only requests take the avtr from the Akyo record, not from a CSV on the image host', async () => {
  const calls: string[] = [];
  const lookedUp: string[] = [];
  const GET = loadRoute(
    async (url) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith('/0003.webp')) {
        return new Response(null, { status: 404 });
      }
      if (target.startsWith('https://vrchat.com/home/avatar/avtr_from-record')) {
        return new Response(html);
      }
      return new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } });
    },
    async (id) => {
      lookedUp.push(id);
      return { id, sourceUrl: 'https://vrchat.com/home/avatar/avtr_from-record' } as AkyoData;
    },
  );
  const response = await GET(new Request('https://akyodex.com/api/avatar-image?id=3'));
  assert.deepEqual(lookedUp, ['0003'], 'the id is normalised to 4 digits before the lookup');
  assert.ok(calls.every((url) => !url.includes('akyo-data-ja.csv')), 'must not fetch the CSV from the image host');
  assert.ok(calls.some((url) => url.startsWith('https://vrchat.com/home/avatar/avtr_from-record')));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Image-Source'), 'vrchat');
});

test('id-only requests without an avatar URL in the record skip VRChat entirely', async () => {
  const calls: string[] = [];
  const GET = loadRoute(
    async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 404 });
    },
    // ワールドのエントリ: sourceUrl に avtr が無い
    async (id) => ({ id, sourceUrl: 'https://vrchat.com/home/world/wrld_x' } as AkyoData),
  );
  const response = await GET(new Request('https://akyodex.com/api/avatar-image?id=0003'));
  assert.ok(calls.every((url) => !url.includes('vrchat.com') && !url.includes('akyo-data-ja.csv')));
  assert.equal(response.ok, false);
});
