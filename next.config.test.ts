import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "./next.config";

test("next image localPatterns allow both avatar and world image proxy routes", () => {
  const localPatterns = nextConfig.images?.localPatterns ?? [];
  const pathnames = localPatterns.map((pattern) => pattern.pathname);

  assert.ok(pathnames.includes("/api/avatar-image"));
  assert.ok(pathnames.includes("/api/vrc-world-image"));
  for (const pattern of localPatterns) {
    assert.equal(pattern.search, undefined);
  }
});

test("Sentry public DSN is available to client and server bundles", () => {
  assert.equal(
    nextConfig.env?.NEXT_PUBLIC_SENTRY_DSN,
    process.env.NEXT_PUBLIC_SENTRY_DSN ?? ""
  );
});
