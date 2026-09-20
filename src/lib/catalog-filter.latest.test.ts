import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import { filterCatalog } from "./catalog-filter";

function item(id: string, category: string, author: string, extra: Partial<AkyoData> = {}): AkyoData {
  return {
    id,
    entryType: "avatar",
    displaySerial: id,
    appearance: "",
    nickname: `nick ${id}`,
    avatarName: `avatar ${id}`,
    category,
    comment: "",
    author,
    attribute: category,
    notes: "",
    creator: author,
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
    ...extra,
  };
}

const ids = (rows: AkyoData[]) => rows.map((row) => row.id);

// 0001〜0105。偶数は 動物、奇数は 食べ物。作者 X は 0003（最新100件の外）と 0103（中）
const entries = Array.from({ length: 105 }, (_, i) => {
  const id = String(i + 1).padStart(4, "0");
  const n = i + 1;
  return item(id, n % 2 === 0 ? "動物" : "食べ物", n === 3 || n === 103 ? "X" : "作者");
});

test("最新100件を先に選び、その中をカテゴリで絞る（絞った結果は 100 件より減る）", () => {
  const result = filterCatalog(entries, { latestCount: 100, categories: ["動物"] }, false);
  assert.equal(result.length, 50, "最新100件（0006〜0105）のうち偶数だけ");
  assert.ok(result.every((row) => Number(row.id) >= 6), "0001〜0005 は最新100件の外なので出ない");
  assert.equal(result[0]!.id, "0104");
  assert.equal(result.at(-1)!.id, "0006");
});

test("最新100件の中を作者で絞る: 100 件の外にいる同じ作者は出ない", () => {
  assert.deepEqual(ids(filterCatalog(entries, { latestCount: 100, authors: ["X"] })), ["0103"]);
  // 最新100件でなければ両方出る
  assert.deepEqual(ids(filterCatalog(entries, { authors: ["X"] }, true)), ["0003", "0103"]);
});

test("最新100件の中を検索・お気に入りで絞る", () => {
  const withFavorite = entries.map((row) => (row.id === "0002" || row.id === "0100" ? { ...row, isFavorite: true } : row));
  assert.deepEqual(ids(filterCatalog(withFavorite, { latestCount: 100, favoritesOnly: true })), ["0100"]);
  // 同じ通称を 100 件の外（0004）と中（0104）に置く → 中だけが出る
  const withNickname = entries.map((row) => (row.id === "0004" || row.id === "0104" ? { ...row, nickname: "パンAkyo" } : row));
  assert.deepEqual(ids(filterCatalog(withNickname, { latestCount: 100, searchQuery: "パン" })), ["0104"]);
  assert.deepEqual(ids(filterCatalog(withNickname, { searchQuery: "パン" }, true)), ["0004", "0104"], "最新100件でなければ両方");
});

test("最新100件の絞り込みは並び順を変えても同じ集合で、昇順は裏返しになる", () => {
  const desc = filterCatalog(entries, { latestCount: 100, categories: ["食べ物"] }, false);
  const asc = filterCatalog(entries, { latestCount: 100, categories: ["食べ物"] }, true);
  assert.deepEqual(ids(asc), ids(desc).reverse());
  assert.equal(desc[0]!.id, "0105");
  assert.equal(asc[0]!.id, "0007");
});

test("最新100件の中でも urlUpdatedAt を持つ行が先に来る", () => {
  const stamped = entries.map((row) => (row.id === "0010" ? { ...row, urlUpdatedAt: "2026-09-19T00:00:00.000Z" } : row));
  const result = filterCatalog(stamped, { latestCount: 100, categories: ["動物"] }, false);
  assert.equal(result[0]!.id, "0010");
  assert.equal(result[1]!.id, "0104");
});
