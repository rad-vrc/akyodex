import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const projectRoot = new URL("../../", import.meta.url);
const serviceWorkerSource = readFileSync(
  new URL("public/sw.js", projectRoot),
  "utf8",
);
const avatarImageRouteSource = readFileSync(
  new URL("src/app/api/avatar-image/route.ts", projectRoot),
  "utf8",
);

test("service worker cache generation invalidates placeholder-contaminated v8 entries", () => {
  assert.match(
    serviceWorkerSource,
    /const CACHE_VERSION = ['"]akyodex-nextjs-v9['"]/,
  );
});

test("both image cache write paths reject redirected responses", () => {
  assert.match(
    serviceWorkerSource,
    /function isCacheableImageResponse\(response\)[\s\S]*response\.ok[\s\S]*!response\.redirected/,
  );

  const guardedWrites = serviceWorkerSource.match(
    /if \(isCacheableImageResponse\((?:resp|networkResponse)\)\) \{\s*await cache\.put\(request, (?:resp|networkResponse)\.clone\(\)\);/g,
  );
  assert.equal(
    guardedWrites?.length,
    2,
    "initial fetch and stale-while-revalidate must both guard cache.put",
  );
});

test("avatar image route returns a non-success response instead of redirecting to the placeholder", () => {
  assert.doesNotMatch(
    avatarImageRouteSource,
    /Response\.redirect\(placeholderUrl, 302\)/,
  );
  assert.match(
    avatarImageRouteSource,
    /createAvatarImageFailureResponse\(failureKind\)/,
  );
});

test("every avatar image JSON error is marked no-store", () => {
  assert.match(
    avatarImageRouteSource,
    /function createNoStoreJsonError[\s\S]*response\.headers\.set\(['"]Cache-Control['"], ['"]no-store['"]\)/,
  );
  assert.doesNotMatch(
    avatarImageRouteSource,
    /return jsonError\(/,
    "route errors must use the no-store wrapper",
  );
});

test('world images use the image cache, refresh in background, and reject ancient or undated copies', async () => {
  type FetchEvent = { request: Request; respondWith(response: Promise<Response>): void; waitUntil(task: Promise<unknown>): void };
  let onFetch: ((event: FetchEvent) => void) | undefined;
  let cached: Response | undefined;
  let resolveFetch: ((response: Response) => void) | undefined;
  let networkCalls = 0;
  const now = Date.UTC(2026, 9, 11);
  runInNewContext(serviceWorkerSource, {
    URL, Request, Response, Date: { now: () => now }, console: { log() {} },
    self: { location: { origin: 'https://akyodex.com' }, addEventListener(name: string, listener: typeof onFetch) {
      if (name === 'fetch') onFetch = listener;
    } },
    caches: { open: async () => ({ match: async () => cached?.clone(),
      put: async (_: Request, response: Response) => { cached = response; },
    }) },
    fetch: async () => { networkCalls++; return new Promise<Response>(resolve => { resolveFetch = resolve; }); },
  });
  function image(text: string, fetchedAt?: number) {
    const response = new Response(text, { headers: { 'Content-Type': 'image/png',
      ...(fetchedAt === undefined ? {} : { 'X-World-Image-Fetched-At': String(fetchedAt) }),
    } });
    Object.defineProperty(response, 'url', { value: 'https://akyodex.com/api/vrc-world-image?wrld=wrld_test' });
    return response;
  }
  function dispatch(path: string) {
    let response!: Promise<Response>;
    const tasks: Promise<unknown>[] = [];
    onFetch!({ request: new Request(`https://akyodex.com${path}`), respondWith(value) { response = value; },
      waitUntil(task) { tasks.push(task); },
    });
    return { response, tasks };
  }
  cached = image('saved', now - (37 * 24 * 3_600_000 - 1));
  const warm = dispatch('/api/vrc-world-image?wrld=wrld_test');
  assert.equal(await (await warm.response).text(), 'saved', 'must respond before the pending network request');
  assert.equal(networkCalls, 1);
  resolveFetch!(image('updated', now));
  await Promise.all(warm.tasks);
  assert.equal(await cached.clone().text(), 'updated');

  for (const stamp of [undefined, now - 37 * 24 * 3_600_000, now + 1000]) {
    cached = image('ancient', stamp);
    const expired = dispatch('/api/vrc-world-image?wrld=wrld_test');
    await new Promise(resolve => setImmediate(resolve));
    resolveFetch!(image('fresh', now));
    assert.equal(await (await expired.response).text(), 'fresh');
  }
  cached = image('avatar', undefined);
  const avatar = dispatch('/api/avatar-image?id=1');
  assert.equal(await (await avatar.response).text(), 'avatar', 'avatar freshness policy is unchanged');
  resolveFetch!(new Response('error', { status: 502 }));
  await Promise.all(avatar.tasks);
  assert.equal(await cached.text(), 'avatar', 'failed refresh must not overwrite the good copy');
});
