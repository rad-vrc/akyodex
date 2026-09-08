import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as entry from './akyo-entry';
import { fetchVrchatResource } from './vrchat-resource-fetch';
import { createAvatarImageFailureResponse } from './avatar-card-image';

const source = readFileSync(new URL('../app/api/avatar-image/route.ts', import.meta.url), 'utf8');

function loadRoute(fetchFn: typeof fetch) {
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    'next/server': { connection: async () => {} },
    '@/lib/api-helpers': { jsonError: (error: string, status: number) => Response.json({ error }, { status }) },
    '@/lib/akyo-entry': entry,
    '@/lib/vrchat-resource-fetch': {
      fetchVrchatResource: (...args: Parameters<typeof fetchVrchatResource>) =>
        fetchVrchatResource(args[0], args[1], args[2], fetchFn),
    },
    '@/lib/avatar-card-image': { createAvatarImageFailureResponse },
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
    const GET = loadRoute(async (url, init) => {
      calls.push(String(url));
      redirectModes.push(init?.redirect);
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
