import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
