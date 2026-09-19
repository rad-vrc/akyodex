import assert from "node:assert/strict";
import test from "node:test";

import { prepareAkyoUpdate } from "./akyo-crud-helpers";
import { createAkyoRecord } from "./csv-utils";

const HEADER = ["ID", "Nickname", "AvatarName", "Category", "Comment", "Author", "AvatarURL", "SourceURL", "EntryType", "DisplaySerial", "BoothURL"];
const BOOTH = "https://booth.pm/ja/items/123";
const URL = "https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc";

// 追加経路は akyo-crud-guard.test.ts が守っているが、更新経路は無防備だった
// （Muse の変異 M9: 更新側の ensureBoothCategories を外しても全テスト緑）
test("prepareAkyoUpdate adds Booth and strips the retired Booth child on update", () => {
  const dataRecords = [
    createAkyoRecord(
      { id: "0001", nickname: "n", avatarName: "a", category: "動物,Booth", author: "x", comment: "", entryType: "avatar", displaySerial: "0001", sourceUrl: URL, avatarUrl: URL, boothUrl: BOOTH },
      HEADER,
    ),
  ];
  // 古い画面状態: 子階層を持ったまま保存しに来る
  const form = {
    id: "0001", nickname: "n", avatarName: "a", entryType: "avatar", displaySerial: "0001",
    sourceUrl: URL, avatarUrl: URL, boothUrl: BOOTH, category: "動物,Booth/アバター", author: "x", comment: "",
  } as unknown as Parameters<typeof prepareAkyoUpdate>[0];

  const updated = prepareAkyoUpdate(form, dataRecords, HEADER);
  assert.equal(updated[0]![HEADER.indexOf("Category")], "動物,Booth");
});

test("prepareAkyoUpdate leaves rows without a BoothURL alone", () => {
  const dataRecords = [
    createAkyoRecord(
      { id: "0001", nickname: "n", avatarName: "a", category: "動物", author: "x", comment: "", entryType: "avatar", displaySerial: "0001", sourceUrl: URL, avatarUrl: URL, boothUrl: undefined },
      HEADER,
    ),
  ];
  const form = {
    id: "0001", nickname: "n", avatarName: "a", entryType: "avatar", displaySerial: "0001",
    sourceUrl: URL, avatarUrl: URL, boothUrl: "", category: "動物", author: "x", comment: "",
  } as unknown as Parameters<typeof prepareAkyoUpdate>[0];

  const updated = prepareAkyoUpdate(form, dataRecords, HEADER);
  assert.equal(updated[0]![HEADER.indexOf("Category")], "動物");
});
