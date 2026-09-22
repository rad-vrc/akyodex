import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import { serializeCatalogPayload } from "@/lib/catalog-payload";
import { handleCatalogRequest } from "./catalog-handler";

function createAkyo(): AkyoData {
  return {
    id: "0001",
    entryType: "avatar",
    appearance: "",
    nickname: "オリジンAkyo",
    avatarName: "Akyo origin",
    category: "チョコミント類",
    comment: "すべてのはじまり",
    author: "ugai",
    attribute: "チョコミント類",
    notes: "すべてのはじまり",
    creator: "ugai",
    sourceUrl: "https://vrchat.com/home/avatar/avtr_test",
    avatarUrl: "https://vrchat.com/home/avatar/avtr_test",
  };
}

test("handleCatalogRequest rejects unsupported languages before reading storage", async () => {
  let storageReads = 0;
  const response = await handleCatalogRequest(
    new Request("https://akyodex.com/api/catalog/fr"),
    "fr",
    {
      readCached: async () => {
        storageReads += 1;
        return null;
      },
      loadData: async () => [createAkyo()],
    },
  );

  assert.equal(response.status, 400);
  assert.equal(storageReads, 0);
});

test("handleCatalogRequest returns completed KV text without loading source data", async () => {
  const serialized = await serializeCatalogPayload("ja", [createAkyo()]);
  let sourceLoads = 0;
  const response = await handleCatalogRequest(
    new Request("https://akyodex.com/api/catalog/ja"),
    "ja",
    {
      readCached: async () => serialized.text,
      loadData: async () => {
        sourceLoads += 1;
        return [createAkyo()];
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(sourceLoads, 0);
  assert.equal(await response.text(), serialized.text);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_kv;dur=/);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_source;desc="kv-payload"/);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_generated;desc="\d+"/);
  assert.doesNotMatch(response.headers.get("Server-Timing") ?? "", /catalog_load;dur=/);
});

test("handleCatalogRequest generates a payload when compact KV is absent", async () => {
  const response = await handleCatalogRequest(
    new Request("https://akyodex.com/api/catalog/en"),
    "en",
    {
      readCached: async () => null,
      loadData: async () => [createAkyo()],
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { language: string; count: number };
  assert.equal(payload.language, "en");
  assert.equal(payload.count, 1);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_load;dur=/);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_serialize;dur=/);
});

test("handleCatalogRequest honors If-None-Match for cached payloads", async () => {
  const serialized = await serializeCatalogPayload("ko", [createAkyo()]);
  const response = await handleCatalogRequest(
    new Request("https://akyodex.com/api/catalog/ko", {
      headers: { "If-None-Match": `"${serialized.revision}"` },
    }),
    "ko",
    {
      readCached: async () => serialized.text,
      loadData: async () => [createAkyo()],
    },
  );

  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_handler;dur=/);
});

test("catalog timings separate KV and fallback waits without changing cache policy", async () => {
  let time = 0;
  const response = await handleCatalogRequest(new Request("https://akyodex.com/api/catalog/ja"), "ja", {
    now: () => time,
    readCached: async () => { time += 8100; return null; },
    loadData: async () => { time += 20; return [createAkyo()]; },
  });
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_kv;dur=8100/);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_load;dur=20/);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_handler;dur=8120/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60, s-maxage=240, stale-while-revalidate=60");
});

test("failed catalog requests still report the phase that waited", async (t) => {
  t.mock.method(console, "error", () => {});
  let time = 0;
  const response = await handleCatalogRequest(new Request("https://akyodex.com/api/catalog/ja"), "ja", {
    now: () => time,
    readCached: async () => { time += 5000; throw new Error("private data"); },
    loadData: async () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 500);
  assert.match(response.headers.get("Server-Timing") ?? "", /catalog_kv;dur=5000/);
  assert.doesNotMatch(response.headers.get("Server-Timing") ?? "", /private/);
});
