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
});
