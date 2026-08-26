import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import {
  INITIAL_CATALOG_ITEM_COUNT,
  createInitialCatalogPayload,
  summarizeCatalog,
} from "./catalog-initial-data";

function createAkyo(
  id: string,
  entryType: AkyoData["entryType"],
  boothUrl = "",
): AkyoData {
  return {
    id,
    entryType,
    appearance: "",
    nickname: `nick-${id}`,
    avatarName: `avatar-${id}`,
    category: entryType === "world" ? "ワールド" : "動物",
    comment: `comment-${id}`,
    author: "author",
    attribute: entryType === "world" ? "ワールド" : "動物",
    notes: "",
    creator: "author",
    sourceUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    boothUrl,
  };
}

test("createInitialCatalogPayload keeps only the first 12 display-ordered entries", () => {
  const items = Array.from({ length: 15 }, (_, index) =>
    createAkyo(String(15 - index).padStart(4, "0"), "avatar"),
  );

  const payload = createInitialCatalogPayload(items);

  assert.equal(INITIAL_CATALOG_ITEM_COUNT, 12);
  assert.equal(payload.items.length, 12);
  assert.deepEqual(
    payload.items.map((item) => item.id),
    Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(4, "0")),
  );
  assert.equal(payload.complete, false);
  assert.equal(payload.totals.entries, 15);
  assert.equal("previewItems" in payload, false);
  assert.equal(payload.items[0]?.comment, "comment-0001");
  assert.equal(
    payload.items[0]?.sourceUrl,
    "https://vrchat.com/home/avatar/avtr_0001",
  );
  assert.equal(payload.items[0]?.attribute, "動物");
});

test("summarizeCatalog reports exact entry, avatar, world, product, and favorite totals", () => {
  const avatar = createAkyo("0001", "avatar", "https://example.com/avatar");
  avatar.isFavorite = true;
  const items = [
    avatar,
    createAkyo("0002", "world"),
    createAkyo("0003", "booth", "https://example.com/product"),
  ];

  assert.deepEqual(summarizeCatalog(items), {
    entries: 3,
    avatars: 1,
    worlds: 1,
    products: 2,
    favorites: 1,
  });
});
