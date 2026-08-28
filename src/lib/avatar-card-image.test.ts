import assert from "node:assert/strict";
import test from "node:test";

import * as avatarCardImageModuleNs from "./avatar-card-image";

type AvatarCardImageFormat = "avif" | "webp";

interface AvatarCardImageFetchResult {
  response: Response;
  transformed: boolean;
}

interface AvatarCardImageModule {
  shouldTransformAvatarCardImage?: (args: {
    width: number;
    bypassCloudflare: boolean;
  }) => boolean;
  getPreferredAvatarCardImageFormat?: (
    accept: string | null,
  ) => AvatarCardImageFormat | null;
  createAvatarCardImageFetchInit?: (args: {
    format: AvatarCardImageFormat | null;
    signal: AbortSignal;
  }) => RequestInit;
  fetchAvatarCardImageWithFallback?: (args: {
    imageUrl: string;
    format: AvatarCardImageFormat | null;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  }) => Promise<AvatarCardImageFetchResult>;
  getAvatarCardImageResponseHeaders?: (
    contentType: string,
    transformed: boolean,
  ) => Headers;
}

const avatarCardImageModule = (
  (avatarCardImageModuleNs as { default?: AvatarCardImageModule }).default ??
  avatarCardImageModuleNs
) as AvatarCardImageModule;

test("only the 768px card request is eligible for transformation", () => {
  const shouldTransform = avatarCardImageModule.shouldTransformAvatarCardImage;
  assert.equal(typeof shouldTransform, "function");
  if (!shouldTransform) return;

  assert.equal(shouldTransform({ width: 768, bypassCloudflare: false }), true);
  assert.equal(shouldTransform({ width: 384, bypassCloudflare: false }), false);
  assert.equal(shouldTransform({ width: 767, bypassCloudflare: false }), false);
  assert.equal(shouldTransform({ width: 800, bypassCloudflare: false }), false);
  assert.equal(shouldTransform({ width: 768, bypassCloudflare: true }), false);
});

test("prefers AVIF, then WebP, and leaves other clients untransformed", () => {
  const getPreferredFormat =
    avatarCardImageModule.getPreferredAvatarCardImageFormat;
  assert.equal(typeof getPreferredFormat, "function");
  if (!getPreferredFormat) return;

  assert.equal(
    getPreferredFormat("image/avif,image/webp,image/*,*/*"),
    "avif",
  );
  assert.equal(getPreferredFormat("image/webp,image/*,*/*"), "webp");
  assert.equal(getPreferredFormat("image/png,image/*,*/*"), null);
});

test("honors Accept quality values and never selects a rejected format", () => {
  const getPreferredFormat =
    avatarCardImageModule.getPreferredAvatarCardImageFormat;
  assert.equal(typeof getPreferredFormat, "function");
  if (!getPreferredFormat) return;

  assert.equal(
    getPreferredFormat("image/avif;q=0,image/webp;q=1"),
    "webp",
  );
  assert.equal(
    getPreferredFormat("image/avif;q=0.2,image/webp;q=0.8"),
    "webp",
  );
  assert.equal(getPreferredFormat("image/avif;q=0,image/webp;q=0"), null);
});

test("uses one fixed 768px Cloudflare transformation", () => {
  const createFetchInit = avatarCardImageModule.createAvatarCardImageFetchInit;
  assert.equal(typeof createFetchInit, "function");
  if (!createFetchInit) return;

  const signal = new AbortController().signal;
  const transformedInit = createFetchInit({ format: "avif", signal });
  assert.deepEqual(transformedInit.cf?.image, {
    width: 768,
    fit: "scale-down",
    quality: 80,
    format: "avif",
  });

  const originalInit = createFetchInit({ format: null, signal });
  assert.equal(originalInit.cf, undefined);
});

test("returns a confirmed transformed response without refetching", async () => {
  const fetchWithFallback =
    avatarCardImageModule.fetchAvatarCardImageWithFallback;
  assert.equal(typeof fetchWithFallback, "function");
  if (!fetchWithFallback) return;

  const calls: RequestInit[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    calls.push(init ?? {});
    return new Response("avif", {
      headers: {
        "Content-Type": "image/avif",
        "Cf-Resized": "quality=80,width=768,format=avif",
      },
    });
  };

  const result = await fetchWithFallback({
    imageUrl: "https://images.akyodex.com/0001.webp",
    format: "avif",
    fetchFn,
  });

  assert.equal(result.transformed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cf?.image?.width, 768);
});

test("refetches the original when Cloudflare silently ignores the transform", async () => {
  const fetchWithFallback =
    avatarCardImageModule.fetchAvatarCardImageWithFallback;
  assert.equal(typeof fetchWithFallback, "function");
  if (!fetchWithFallback) return;

  const calls: RequestInit[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    calls.push(init ?? {});
    return new Response(calls.length === 1 ? "unconfirmed" : "original", {
      headers: { "Content-Type": "image/webp" },
    });
  };

  const result = await fetchWithFallback({
    imageUrl: "https://images.akyodex.com/0001.webp",
    format: "avif",
    fetchFn,
  });

  assert.equal(result.transformed, false);
  assert.equal(await result.response.text(), "original");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cf?.image?.format, "avif");
  assert.equal(calls[1].cf, undefined);
});

test("refetches the original after a transformation error", async () => {
  const fetchWithFallback =
    avatarCardImageModule.fetchAvatarCardImageWithFallback;
  assert.equal(typeof fetchWithFallback, "function");
  if (!fetchWithFallback) return;

  let callCount = 0;
  const fetchFn: typeof fetch = async () => {
    callCount += 1;
    if (callCount === 1) throw new Error("9422 transformation limit");
    return new Response("original", {
      headers: { "Content-Type": "image/webp" },
    });
  };

  const result = await fetchWithFallback({
    imageUrl: "https://images.akyodex.com/0001.webp",
    format: "webp",
    fetchFn,
  });

  assert.equal(result.transformed, false);
  assert.equal(callCount, 2);
});

test("varies browser caching by Accept and reports transformation status", () => {
  const getResponseHeaders =
    avatarCardImageModule.getAvatarCardImageResponseHeaders;
  assert.equal(typeof getResponseHeaders, "function");
  if (!getResponseHeaders) return;

  const headers = getResponseHeaders("image/avif", true);
  assert.equal(headers.get("Content-Type"), "image/avif");
  assert.equal(headers.get("Vary"), "Accept");
  assert.equal(headers.get("X-Image-Transformed"), "true");
  assert.match(headers.get("Cache-Control") ?? "", /max-age=86400/);
});
