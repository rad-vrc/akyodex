import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFavoritesToPreparedCatalog,
  haveSameCatalogItemReferences,
  prepareCatalogItemsInChunks,
} from "./catalog-preparation";
import type { AkyoData } from "@/types/akyo";

function createAkyo(id: string, overrides: Partial<AkyoData> = {}): AkyoData {
  return {
    id,
    entryType: "avatar",
    displaySerial: id,
    appearance: "",
    nickname: `Akyo ${id}`,
    avatarName: `Avatar ${id}`,
    category: "自然,自然/植物",
    comment: "カタログ検索用コメント",
    author: "作者",
    attribute: "自然,自然/植物",
    notes: "カタログ検索用コメント",
    creator: "作者",
    sourceUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    ...overrides,
  };
}

test("prepareCatalogItemsInChunks builds exact filter indexes while yielding between long slices", async () => {
  const items = Array.from({ length: 6 }, (_, index) =>
    createAkyo(String(index + 1).padStart(4, "0")),
  );
  let currentTime = 0;
  let yieldCount = 0;

  const prepared = await prepareCatalogItemsInChunks(items, {
    timeBudgetMs: 8,
    now: () => {
      currentTime += 5;
      return currentTime;
    },
    yieldToMainThread: async () => {
      yieldCount += 1;
    },
  });

  assert.ok(yieldCount > 0);
  assert.deepEqual(prepared[0]?.parsedCategory, ["自然", "自然/植物"]);
  assert.deepEqual(prepared[0]?.parsedAuthor, ["作者"]);
  assert.ok(prepared[0]?._searchIndex?.includes("akyo 0001"));
  assert.ok(prepared[0]?._searchIndex?.includes("かたろぐ検索用こめんと"));
});

test("prepareCatalogItemsInChunks stops after an abort between slices", async () => {
  const controller = new AbortController();
  let currentTime = 0;

  await assert.rejects(
    prepareCatalogItemsInChunks(
      [createAkyo("0001"), createAkyo("0002"), createAkyo("0003")],
      {
        signal: controller.signal,
        timeBudgetMs: 1,
        now: () => {
          currentTime += 2;
          return currentTime;
        },
        yieldToMainThread: async () => {
          controller.abort();
        },
      },
    ),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("applyFavoritesToPreparedCatalog reuses equivalent initial card objects", async () => {
  const initial = createAkyo("0001", { isFavorite: true });
  const prepared = await prepareCatalogItemsInChunks([
    createAkyo("0001"),
    createAkyo("0002"),
  ]);
  const previous = (
    await prepareCatalogItemsInChunks([initial])
  )[0]!;

  const result = applyFavoritesToPreparedCatalog(
    prepared,
    ["0001"],
    [previous],
  );

  assert.equal(result[0]?.id, "0001");
  assert.equal(result[0]?.isFavorite, true);
  assert.equal(result[0], previous);
  assert.notEqual(result[1], undefined);
});

test("applyFavoritesToPreparedCatalog does not reuse an entry whose visible data changed", async () => {
  const previous = (
    await prepareCatalogItemsInChunks([
      createAkyo("0001", { nickname: "Before", isFavorite: false }),
    ])
  )[0]!;
  const prepared = await prepareCatalogItemsInChunks([
    createAkyo("0001", { nickname: "After" }),
  ]);

  const result = applyFavoritesToPreparedCatalog(prepared, [], [previous]);

  assert.notEqual(result[0], previous);
  assert.equal(result[0]?.nickname, "After");
});

test("haveSameCatalogItemReferences detects an unchanged rendered sequence", () => {
  const first = createAkyo("0001");
  const second = createAkyo("0002");

  assert.equal(
    haveSameCatalogItemReferences([first, second], [first, second]),
    true,
  );
  assert.equal(
    haveSameCatalogItemReferences([first, second], [first, { ...second }]),
    false,
  );
  assert.equal(
    haveSameCatalogItemReferences([first, second], [second, first]),
    false,
  );
});
