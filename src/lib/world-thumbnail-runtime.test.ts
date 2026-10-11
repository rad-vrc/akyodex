import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { R2Bucket } from '@cloudflare/workers-types';

const require = createRequire(import.meta.url);
const fromWrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = fromWrangler('miniflare');
const { buildSync } = fromWrangler('esbuild');

test('workerd returns stale R2 bytes before upstream completes and conditionally replaces them', { timeout: 30_000 }, async () => {
  const pending: Array<(response: Response) => void> = [];
  let calls = 0;
  const script = buildSync({ stdin: { contents: `
    import { serveWorldThumbnail } from './world-thumbnail-cache.ts';
    export default { fetch(request, env, ctx) {
      return serveWorldThumbnail({ wrld: 'wrld_test', width: 512, format: 'avif', store: env.CACHE,
        after: task => ctx.waitUntil(task()),
        load: signal => fetch('https://upstream.invalid/image', { signal }) });
    } };`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', write: false,
  }).outputFiles[0].text;
  const runtime: { ready: Promise<URL>; getR2Bucket(name: string): Promise<R2Bucket>; dispose(): Promise<void> } =
    new Miniflare({ ...convertV4MiniflareOptions({
      script, modules: true, compatibilityDate: '2026-08-27', cf: false, r2Buckets: ['CACHE'],
      outboundService: async () => { calls++; return new Promise<Response>(resolve => pending.push(resolve)); },
    }), telemetry: { enabled: false } });
  const key = 'world-thumbnails/v1/wrld_test/512/avif';
  async function until(check: () => Promise<boolean>) {
    for (let i = 0; i < 100; i++) { if (await check()) return; await delay(20); }
    assert.fail('background operation did not complete');
  }
  try {
    const bucket = await runtime.getR2Bucket('CACHE');
    await bucket.put(key, 'version-7', { httpMetadata: { contentType: 'image/avif' },
      customMetadata: { fetchedAt: String(Date.now() - 30 * 24 * 3_600_000 - 1000), transformed: 'true' },
    });
    const url = await runtime.ready;
    const old = await fetch(url, { signal: AbortSignal.timeout(3000) });
    assert.equal(await old.text(), 'version-7');
    assert.equal(old.headers.get('X-World-Image-Cache'), 'STALE');
    const concurrent = await fetch(url, { signal: AbortSignal.timeout(3000) });
    assert.equal(await concurrent.text(), 'version-7');
    await until(async () => pending.length === 2);
    pending[1](new Response('version-9', { headers: { 'Content-Type': 'image/avif' } }));
    await until(async () => (await bucket.get(key))?.text().then(value => value === 'version-9') ?? false);
    pending[0](new Response('version-8', { headers: { 'Content-Type': 'image/avif' } }));
    await delay(100);
    const fresh = await fetch(url);
    assert.equal(await fresh.text(), 'version-9', 'late refresh must fail its real R2 conditional write');
    assert.equal(fresh.headers.get('X-World-Image-Cache'), 'HIT');
    assert.equal(calls, 2, 'warm R2 skips upstream');
  } finally {
    for (const resolve of pending) resolve(new Response('cleanup', { status: 502 }));
    await runtime.dispose();
  }
});
