import assert from "node:assert/strict";
import test from "node:test";

import { getAkyoDataFromJSON } from "./akyo-data-json";

// R2 JSON → KV 更新（/api/revalidate, /api/kv-migrate）の入口。ここで urlUpdatedAt を
// 落とすと、次の revalidate で KV から刻印が消えて「最新 100 件」が ID 順に戻る
test("getAkyoDataFromJSON keeps urlUpdatedAt from the R2 JSON and drops blank values", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_R2_BASE;
  process.env.NEXT_PUBLIC_R2_BASE = "https://images.example.com";
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({
        version: "1.0",
        language: "ja",
        updatedAt: "2026-09-18T00:00:00.000Z",
        count: 2,
        data: [
          {
            id: "0001",
            nickname: "n1",
            avatarName: "a1",
            category: "動物",
            comment: "",
            author: "x",
            avatarUrl: "https://vrchat.com/home/avatar/avtr_1",
            urlUpdatedAt: "2026-09-18T01:02:03.000Z",
          },
          {
            id: "0002",
            nickname: "n2",
            avatarName: "a2",
            category: "動物",
            comment: "",
            author: "x",
            avatarUrl: "https://vrchat.com/home/avatar/avtr_2",
            urlUpdatedAt: "   ",
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const data = await getAkyoDataFromJSON("ja");
    assert.deepEqual(requested, ["https://images.example.com/data/akyo-data-ja.json"]);
    assert.equal(data[0]?.id, "0001");
    assert.equal(data[0]?.urlUpdatedAt, "2026-09-18T01:02:03.000Z");
    assert.equal(data[1]?.urlUpdatedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      Reflect.deleteProperty(process.env, "NEXT_PUBLIC_R2_BASE");
    } else {
      process.env.NEXT_PUBLIC_R2_BASE = originalBase;
    }
  }
});
