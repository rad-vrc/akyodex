import assert from "node:assert/strict";
import test from "node:test";

import {
  createReferenceSheetImageFetchInit,
  fetchReferenceSheetImage,
  getReferenceSheetResponseEtag,
  isReferenceSheetId,
} from "./reference-sheet-image";

test("accepts only four-digit reference sheet IDs", () => {
  assert.equal(isReferenceSheetId("0001"), true);
  assert.equal(isReferenceSheetId("0834"), true);
  assert.equal(isReferenceSheetId("1"), false);
  assert.equal(isReferenceSheetId("00001"), false);
  assert.equal(isReferenceSheetId("abcd"), false);
});

test("invalid IDs return a non-cacheable 400 response", async () => {
  const result = await fetchReferenceSheetImage({
    id: "../0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
  });

  assert.equal(result.response.status, 400);
  assert.equal(result.failureStage, "validation");
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
});

test("uses one fixed 1920px WebP transformation", () => {
  const signal = new AbortController().signal;
  const init = createReferenceSheetImageFetchInit(signal);

  assert.equal(init.method, "GET");
  assert.equal(new Headers(init.headers).get("Accept"), "image/webp");
  assert.deepEqual(init.cf?.image, {
    width: 1920,
    fit: "scale-down",
    quality: 82,
    format: "webp",
  });
});

test("uses the source ETag in the transform URL and streams a confirmed WebP", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (init.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ETag: '"source-v2"', "Content-Type": "image/png" },
      });
    }

    return new Response("transformed", {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cf-Resized": "width=1920,quality=82,format=webp",
      },
    });
  };

  const result = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn,
  });

  assert.equal(result.failureStage, undefined);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("Content-Type"), "image/webp");
  assert.equal(result.response.headers.get("X-Image-Transformed"), "true");
  assert.equal(
    result.response.headers.get("Cache-Control"),
    "public, max-age=0, must-revalidate",
  );
  assert.equal(await result.response.text(), "transformed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://images.akyodex.com/0800.png");
  assert.equal(calls[0].init.method, "HEAD");
  assert.match(calls[1].url, /^https:\/\/images\.akyodex\.com\/0800\.png\?v=/);
  assert.equal(new URL(calls[1].url).searchParams.get("v"), "source-v2");
});

test("returns 304 before transformation when the source ETag is unchanged", async () => {
  let callCount = 0;
  const fetchFn: typeof fetch = async (_input, init = {}) => {
    callCount += 1;
    assert.equal(init.method, "HEAD");
    return new Response(null, {
      status: 200,
      headers: { ETag: '"source-v1"' },
    });
  };
  const responseEtag = getReferenceSheetResponseEtag('"source-v1"');

  const result = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: responseEtag,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn,
  });

  assert.equal(result.response.status, 304);
  assert.equal(result.response.headers.get("ETag"), responseEtag);
  assert.equal(callCount, 1);
});

test("a changed source ETag creates a new transformation URL", async () => {
  const transformedUrls: string[] = [];
  let sourceEtag = '"source-v1"';
  const fetchFn: typeof fetch = async (input, init = {}) => {
    if (init.method === "HEAD") {
      return new Response(null, { headers: { ETag: sourceEtag } });
    }
    transformedUrls.push(String(input));
    return new Response("image", {
      headers: {
        "Content-Type": "image/webp",
        "Cf-Resized": "width=1920,format=webp",
      },
    });
  };

  await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn,
  });
  sourceEtag = '"source-v2"';
  await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn,
  });

  assert.equal(transformedUrls.length, 2);
  assert.notEqual(transformedUrls[0], transformedUrls[1]);
});

test("distinguishes missing sources from upstream failures", async () => {
  const notFound = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn: async () => new Response(null, { status: 404 }),
  });
  assert.equal(notFound.response.status, 404);
  assert.equal(notFound.failureStage, "source-head");
  assert.equal(notFound.response.headers.get("Cache-Control"), "no-store");

  const upstreamFailure = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn: async () => new Response(null, { status: 503 }),
  });
  assert.equal(upstreamFailure.response.status, 502);
  assert.equal(upstreamFailure.failureStage, "source-head");
  assert.equal(upstreamFailure.response.headers.get("Cache-Control"), "no-store");
});

test("rejects unconfirmed transformations instead of proxying the original PNG", async () => {
  let callCount = 0;
  const result = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn: async (_input, init = {}) => {
      callCount += 1;
      if (init.method === "HEAD") {
        return new Response(null, { headers: { ETag: '"source-v1"' } });
      }
      return new Response("original-png", {
        headers: {
          "Content-Type": "image/png",
          "Cf-Resized": "err=9422",
        },
      });
    },
  });

  assert.equal(result.response.status, 502);
  assert.equal(result.failureStage, "transform");
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
  assert.equal(callCount, 2);
});

test("rejects a WebP response without Cloudflare transform confirmation", async () => {
  const result = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    fetchFn: async (_input, init = {}) => {
      if (init.method === "HEAD") {
        return new Response(null, { headers: { ETag: '"source-v1"' } });
      }
      return new Response("unconfirmed-webp", {
        headers: { "Content-Type": "image/webp" },
      });
    },
  });

  assert.equal(result.response.status, 502);
  assert.equal(result.failureStage, "transform");
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
});

test("returns a non-cacheable 504 when the shared deadline expires", async () => {
  const result = await fetchReferenceSheetImage({
    id: "0800",
    ifNoneMatch: null,
    r2BaseUrl: "https://images.akyodex.com",
    timeoutMs: 5,
    fetchFn: async (_input, init = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  });

  assert.equal(result.response.status, 504);
  assert.equal(result.failureStage, "timeout");
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
});
