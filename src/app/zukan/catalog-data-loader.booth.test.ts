import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import { createCatalogPayload } from "@/lib/catalog-payload";
import { loadCompleteCatalogData } from "./catalog-data-loader";

function createAkyo(id: string, category: string): AkyoData {
  return {
    id,
    entryType: "avatar",
    appearance: "",
    nickname: `nick-${id}`,
    avatarName: `avatar-${id}`,
    category,
    comment: "",
    author: "author",
    attribute: category,
    notes: "",
    creator: "author",
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    boothUrl: "https://booth.pm/ja/items/1",
  };
}

// catalog:v1:* は KV に置かれた本文をそのまま返すので、旧コードが書いた本文には
// 子階層が残り得る。クライアントの正規化で落とす
test("loadCompleteCatalogData drops the retired Booth child from stale catalog payloads", async () => {
  const payload = await createCatalogPayload("ja", [createAkyo("0001", "動物,Booth"), createAkyo("0002", "動物,Booth")]);
  // 生の本文に、旧コードが書いたのと同じ形で子階層を仕込む
  payload.data[0] = { ...payload.data[0]!, category: "動物,Booth,Booth/アバター" };
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await loadCompleteCatalogData({
    lang: "ja",
    catalogUrl: "/api/catalog/ja",
    r2BaseUrl: "https://images.example.com",
    fetchImpl,
  });

  assert.equal(result.items[0]?.category, "動物,Booth");
  assert.equal(result.items[0]?.attribute, "動物,Booth");
  assert.equal(result.items[1]?.category, "動物,Booth");
});
