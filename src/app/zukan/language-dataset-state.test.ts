import assert from "node:assert/strict";
import test from "node:test";

import {
  createLanguageDatasetCacheEntry,
  resolveImmediateLanguageDataset,
} from "./language-dataset-state";
import type { AkyoData } from "@/types/akyo";

function createAkyo(id: string): AkyoData {
  return {
    id,
    appearance: "",
    nickname: `nick-${id}`,
    avatarName: `avatar-${id}`,
    category: "チョコミント類",
    comment: "",
    author: "author",
    attribute: "チョコミント類",
    notes: "",
    creator: "author",
    avatarUrl: `https://vrchat.com/home/avatar/avtr_${id}`,
  };
}

test("resolveImmediateLanguageDataset restores the server dataset when returning to serverLang", () => {
  const serverDataset = createLanguageDatasetCacheEntry({
    items: [createAkyo("0001")],
    categories: ["ja-category"],
    authors: ["ja-author"],
    complete: false,
  });

  const resolved = resolveImmediateLanguageDataset({
    lang: "ja",
    serverLang: "ja",
    serverDataset,
  });

  assert.deepEqual(resolved, serverDataset);
  assert.equal(resolved?.complete, false);
});

test("resolveImmediateLanguageDataset uses cached language datasets for non-server languages", () => {
  const serverDataset = createLanguageDatasetCacheEntry({
    items: [createAkyo("0001")],
    categories: ["ja-category"],
    authors: ["ja-author"],
    complete: false,
  });
  const cachedDataset = createLanguageDatasetCacheEntry({
    items: [createAkyo("0002")],
    categories: ["en-category"],
    authors: ["en-author"],
    complete: true,
  });

  const resolved = resolveImmediateLanguageDataset({
    lang: "en",
    serverLang: "ja",
    cachedDataset,
    serverDataset,
  });

  assert.deepEqual(resolved, cachedDataset);
  assert.equal(resolved?.complete, true);
});

test("resolveImmediateLanguageDataset returns null when a non-server language is uncached", () => {
  const serverDataset = createLanguageDatasetCacheEntry({
    items: [createAkyo("0001")],
    categories: ["ja-category"],
    authors: ["ja-author"],
    complete: false,
  });

  const resolved = resolveImmediateLanguageDataset({
    lang: "en",
    serverLang: "ja",
    serverDataset,
  });

  assert.equal(resolved, null);
});
