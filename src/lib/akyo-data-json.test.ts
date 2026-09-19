import assert from "node:assert/strict";
import test from "node:test";

import { getAkyoDataFromJSON } from "./akyo-data-json";

function withMockedJson<T>(data: unknown[], run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_R2_BASE;
  process.env.NEXT_PUBLIC_R2_BASE = "https://images.example.com";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ version: "1.0", language: "ja", updatedAt: "2026-09-18T00:00:00.000Z", count: data.length, data }),
      { headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      Reflect.deleteProperty(process.env, "NEXT_PUBLIC_R2_BASE");
    } else {
      process.env.NEXT_PUBLIC_R2_BASE = originalBase;
    }
  });
}

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  nickname: `n${id}`,
  avatarName: `a${id}`,
  category: "動物",
  comment: "",
  author: "x",
  avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
  ...extra,
});

// R2 JSON → KV 更新（/api/revalidate, /api/kv-migrate）の入口。ここで urlUpdatedAt を
// 落とすと、次の revalidate で KV から刻印が消えて「最新 100 件」が ID 順に戻る
test("getAkyoDataFromJSON keeps urlUpdatedAt from the R2 JSON and drops blank values", async () => {
  await withMockedJson(
    [row("0001", { urlUpdatedAt: "2026-09-18T01:02:03.000Z" }), row("0002", { urlUpdatedAt: "   " })],
    async () => {
      const data = await getAkyoDataFromJSON("ja");
      assert.equal(data[0]?.id, "0001");
      assert.equal(data[0]?.urlUpdatedAt, "2026-09-18T01:02:03.000Z");
      assert.equal(data[1]?.urlUpdatedAt, undefined);
    },
  );
});

// 同じ入口で ensureBoothCategories を外すと、古い JSON の Booth/アバター が KV に
// そのまま書き戻される（Muse の変異 M8）
test("getAkyoDataFromJSON adds Booth for boothUrl rows and drops the retired Booth child", async () => {
  await withMockedJson(
    [
      row("0001", { category: "動物,Booth,Booth/アバター", boothUrl: "https://booth.pm/ja/items/1" }),
      row("0002", { category: "動物", boothUrl: "https://booth.pm/ja/items/2" }),
      row("0003", { category: "動物,Booth/アバター" }),
    ],
    async () => {
      const data = await getAkyoDataFromJSON("ja");
      assert.deepEqual(
        data.map((item) => [item.id, item.category]),
        [
          ["0001", "動物,Booth"],
          ["0002", "動物,Booth"],
          ["0003", "動物"], // boothUrl が無くても、廃止した子は読む側で落ちる
        ],
      );
    },
  );
});
