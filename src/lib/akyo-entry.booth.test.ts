import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import { hydrateAkyoDataset } from "./akyo-entry";

function entry(id: string, category: string): AkyoData {
  return {
    id,
    entryType: "avatar",
    displaySerial: id,
    appearance: "",
    nickname: `n${id}`,
    avatarName: `a${id}`,
    category,
    comment: "",
    author: "x",
    attribute: category,
    notes: "",
    creator: "x",
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    boothUrl: "https://booth.pm/ja/items/1",
  };
}

// KV の生データ（akyo-data-*）は ensureBoothCategories を通らずここに来る。旧コードの
// 本番 Worker が revalidate で KV を書き直すと子階層が復活するので、読む側で落とす
test("hydrateAkyoDataset drops the retired Booth child from category and attribute", () => {
  const [stale, clean] = hydrateAkyoDataset([
    entry("0001", "動物,Booth,Booth/アバター"),
    entry("0002", "動物,Booth"),
  ]);
  assert.equal(stale!.category, "動物,Booth");
  assert.equal(stale!.attribute, "動物,Booth");
  assert.equal(clean!.category, "動物,Booth");
  assert.equal(clean!.attribute, "動物,Booth");
});
