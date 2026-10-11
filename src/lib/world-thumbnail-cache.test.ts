import assert from 'node:assert/strict';
import test from 'node:test';
import type { R2PutOptions } from '@cloudflare/workers-types';
import { serveWorldThumbnail, type WorldThumbnailStore } from './world-thumbnail-cache';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 11);
const request = { wrld: 'wrld_test', width: 512, format: 'avif' as const };
const image = (text = 'version-7') => new Response(text, { headers: {
  'Content-Type': 'image/avif', 'X-Image-Transformed': 'true',
} });

function fixture() {
  let now = START;
  const objects = new Map<string, { bytes: ArrayBuffer; etag: string; options: R2PutOptions }>();
  let revision = 0;
  const writes: string[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const warnings: string[] = [];
  const store: WorldThumbnailStore = {
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      const metadata = value.options.httpMetadata;
      return { etag: value.etag, size: value.bytes.byteLength,
        httpMetadata: metadata && 'contentType' in metadata ? { contentType: metadata.contentType } : undefined,
        customMetadata: value.options.customMetadata,
        arrayBuffer: async () => value.bytes.slice(0),
      };
    },
    async put(key, bytes, options) {
      const previous = objects.get(key);
      const condition = options.onlyIf;
      assert.ok(condition && !(condition instanceof Headers));
      if (('etagMatches' in condition && condition.etagMatches !== previous?.etag) ||
          ('etagDoesNotMatch' in condition && condition.etagDoesNotMatch === '*' && previous)) return null;
      writes.push(key);
      objects.set(key, { bytes: bytes.slice(0), etag: String(++revision), options });
      return {};
    },
  };
  const serve = (load: (signal: AbortSignal) => Promise<Response>, options: Pick<Parameters<typeof serveWorldThumbnail>[0], 'wrld' | 'width' | 'format'> = request) => serveWorldThumbnail({
    ...options, store, load, after: task => { tasks.push(task); }, now: () => now,
    warn: reason => { warnings.push(reason); },
  });
  const flush = async () => { while (tasks.length) await tasks.shift()!(); };
  return { store, objects, writes, tasks, warnings, serve, flush, advance: (ms: number) => { now += ms; } };
}

test('a saved world thumbnail is returned without consulting VRChat', async () => {
  const f = fixture();
  assert.equal(await (await f.serve(async () => image())).text(), 'version-7');
  await f.flush();
  const cached = await f.serve(async () => { throw new Error('VRChat must not be consulted'); });
  assert.equal(await cached.text(), 'version-7');
  assert.equal(cached.headers.get('X-World-Image-Cache'), 'HIT');
  assert.equal(f.tasks.length, 0);
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0], /^world-thumbnails\/v1\/wrld_test\/512\/avif$/);
});

test('six-hour-old images display immediately and update to the next version in the background', async () => {
  const f = fixture();
  await f.serve(async () => image());
  await f.flush();
  f.advance(6 * HOUR);
  let called = false;
  const stale = await f.serve(async () => { called = true; return image('version-8'); });
  assert.equal(await stale.text(), 'version-7');
  assert.equal(called, false, 'refresh must be scheduled after the response');
  assert.equal(stale.headers.get('X-World-Image-Cache'), 'STALE');
  await f.flush();
  const current = await f.serve(async () => { throw new Error('already refreshed'); });
  assert.equal(await current.text(), 'version-8');
  assert.equal(current.headers.get('X-World-Image-Cache'), 'HIT');
});

test('failed refreshes keep the good image without resetting its age', async () => {
  const f = fixture();
  await f.serve(async () => image());
  await f.flush();
  f.advance(6 * HOUR);
  assert.equal(await (await f.serve(async () => new Response('failure', { status: 502 }))).text(), 'version-7');
  await f.flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.warnings.length, 1);
  f.advance(7 * 24 * HOUR);
  const expired = await f.serve(async () => new Response('failure', { status: 502 }));
  assert.equal(expired.status, 502, 'never keep serving the original indefinitely');
  assert.equal(expired.headers.get('Cache-Control'), 'no-store');
});

test('late refreshes cannot overwrite a newer stored image', async () => {
  const f = fixture();
  await f.serve(async () => image());
  await f.flush();
  f.advance(6 * HOUR);
  await f.serve(async () => image('version-8'));
  await f.serve(async () => image('version-9'));
  const [older, newer] = f.tasks.splice(0);
  await newer();
  await older();
  assert.equal(await (await f.serve(async () => image('unexpected'))).text(), 'version-9');
});

test('format and size have separate cache keys; arbitrary query parameters do not', async () => {
  const f = fixture();
  await f.serve(async () => image());
  await f.flush();
  await f.serve(async () => new Response('webp', { headers: { 'Content-Type': 'image/webp' } }), { ...request, format: 'webp' });
  await f.serve(async () => image('large'), { ...request, width: 1024 });
  await f.flush();
  assert.equal(f.objects.size, 3);
});

test('non-images, redirects, empty bodies and HTTP failures never enter the image store', async () => {
  for (const response of [new Response('html'), new Response(null, {status: 302}),
    new Response('error', {status: 404}), image('')]) {
    const f = fixture();
    const result = await f.serve(async () => response);
    await f.flush();
    assert.ok(result.status >= 400);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(f.writes.length, 0);
  }
});

test('missing or failed storage does not prevent live images from displaying', async () => {
  const f = fixture();
  f.store.get = async () => { throw new Error('R2 unavailable'); };
  const result = await f.serve(async () => image());
  assert.equal(await result.text(), 'version-7');
  assert.equal(f.tasks.length, 0, 'a failed read must not overwrite unknown stored state');
  const direct = await serveWorldThumbnail({ ...request, store: null, load: async () => image(), after() {} });
  assert.equal(await direct.text(), 'version-7');
});

test('one live deadline covers stalled headers and bodies, cancels the body, and permits retry', async () => {
  for (const phase of ['headers', 'body']) {
    let signal: AbortSignal | undefined;
    let cancelled = false;
    const response = await serveWorldThumbnail({ ...request, store: null, timeoutMs: 10,
      warn() {}, after() {}, load: async activeSignal => {
        signal = activeSignal;
        if (phase === 'headers') return new Promise<Response>(() => {});
        return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
          headers: { 'Content-Type': 'image/png' },
        });
      },
    });
    assert.equal(response.status, 504);
    assert.equal(signal?.aborted, true);
    if (phase === 'body') assert.equal(cancelled, true);
    assert.equal((await serveWorldThumbnail({ ...request, store: null, load: async () => image(), after() {} })).status, 200);
  }
});

test('a stalled R2 read falls back to VRChat and never writes unknown cache state', async () => {
  const f = fixture();
  f.store.get = async () => new Promise(() => {});
  const response = await serveWorldThumbnail({ ...request, store: f.store, load: async () => image(),
    cacheReadTimeoutMs: 10, warn() {}, after() { assert.fail('must not persist after an uncertain read'); },
  });
  assert.equal(await response.text(), 'version-7');
});

test('failed background writes do not change a successful response', async () => {
  const f = fixture();
  f.store.put = async () => { throw new Error('write failed'); };
  const response = await f.serve(async () => image());
  await f.flush();
  assert.equal(await response.text(), 'version-7');
  assert.deepEqual(f.warnings, ['cache-write-failed']);
});

test('oversized images are cancelled and never persisted', async () => {
  const f = fixture();
  let cancelled = false;
  const response = await f.serve(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'image/png' } }));
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
  await f.flush();
  assert.equal(f.writes.length, 0);
});
