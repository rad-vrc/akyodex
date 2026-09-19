import assert from "node:assert/strict";
import test from "node:test";

import { ensureBoothCategories, stripLegacyBoothChildren, validateBoothUrl } from "./booth-url";

test("stripLegacyBoothChildren は boothUrl に関係なく廃止した子階層だけを取り除く", () => {
  assert.equal(stripLegacyBoothChildren("動物,Booth,Booth/アバター"), "動物,Booth");
  assert.equal(stripLegacyBoothChildren("Animal,Booth/Avatar,Booth"), "Animal,Booth");
  assert.equal(stripLegacyBoothChildren("동물,Booth/아바타"), "동물");
  assert.equal(stripLegacyBoothChildren("Booth/アバター"), "");
  // 取り除くものが無ければ入力をそのまま返す（整形もしない）
  const untouched = "動物 , Booth,対応機種/PC";
  assert.equal(stripLegacyBoothChildren(untouched), untouched);
  assert.equal(stripLegacyBoothChildren(""), "");
  // Booth/ で始まる別の（将来の）子は対象外
  assert.equal(stripLegacyBoothChildren("Booth,Booth/ワールド"), "Booth,Booth/ワールド");
});

const BOOTH = "https://booth.pm/ja/items/123";

test("ensureBoothCategories は boothUrl があれば Booth だけを足し、子階層は付けない", () => {
  assert.equal(ensureBoothCategories("動物", BOOTH), "動物,Booth");
  assert.equal(ensureBoothCategories("", BOOTH), "Booth");
  // すでにあれば重複させない
  assert.equal(ensureBoothCategories("動物,Booth", BOOTH), "動物,Booth");
  // 空白やカンマ区切りの揺れは整える
  assert.equal(ensureBoothCategories(" 動物 , , Booth ", BOOTH), "動物,Booth");
  // 以前は entryType=avatar のとき Booth/アバター を足していた。今は何も足さない
  for (const category of ["動物", "動物,Booth", "ワールド"]) {
    assert.ok(!ensureBoothCategories(category, BOOTH).includes("Booth/"), category);
  }
});

test("ensureBoothCategories は廃止した Booth の子階層を各言語とも取り除く", () => {
  assert.equal(ensureBoothCategories("動物,Booth,Booth/アバター", BOOTH), "動物,Booth");
  assert.equal(ensureBoothCategories("Animal,Booth,Booth/Avatar", BOOTH), "Animal,Booth");
  assert.equal(ensureBoothCategories("동물,Booth,Booth/아바타", BOOTH), "동물,Booth");
  // 子が先に来ていても Booth は 1 つだけ残る
  assert.equal(ensureBoothCategories("Booth/アバター,動物", BOOTH), "動物,Booth");
});

test("ensureBoothCategories は boothUrl が無ければ何もしない", () => {
  assert.equal(ensureBoothCategories("動物", undefined), "動物");
  assert.equal(ensureBoothCategories("動物,Booth/アバター", undefined), "動物,Booth/アバター", "URL の無い行は触らない（データ側で消す）");
  assert.equal(ensureBoothCategories("", ""), "");
});

test("validateBoothUrl は https の booth.pm 系だけを通す", () => {
  assert.equal(validateBoothUrl(" https://booth.pm/ja/items/123 "), "https://booth.pm/ja/items/123");
  assert.equal(validateBoothUrl("https://example.booth.pm/items/1"), "https://example.booth.pm/items/1");
  assert.equal(validateBoothUrl("http://booth.pm/ja/items/123"), undefined);
  assert.equal(validateBoothUrl("https://notbooth.pm/x"), undefined);
  assert.equal(validateBoothUrl("https://booth.pm.evil.example/x"), undefined);
  assert.equal(validateBoothUrl(""), undefined);
  assert.equal(validateBoothUrl(null), undefined);
});
