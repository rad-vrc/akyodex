import assert from "node:assert/strict";
import test from "node:test";

import * as akyoEntryModuleNs from "./akyo-entry";

const akyoEntryModule =
  (akyoEntryModuleNs as { default?: Record<string, unknown> }).default ??
  (akyoEntryModuleNs as Record<string, unknown>);

const resolveDisplaySerialForSourceUrlChange =
  akyoEntryModule.resolveDisplaySerialForSourceUrlChange as
    | ((args: {
        currentDisplaySerial: string;
        detectedEntryType: "avatar" | "world" | null;
        id: string;
        originalDisplaySerial?: string;
        originalEntryType?: "avatar" | "world";
      }) => string)
    | undefined;

const getPublicDisplayId = akyoEntryModule.getPublicDisplayId as
  | ((entry: {
      id: string;
      entryType?: "avatar" | "world";
      displaySerial?: string;
      category?: string;
      attribute?: string;
      appearance: string;
      nickname: string;
      avatarName: string;
      comment: string;
      author: string;
      notes: string;
      creator: string;
      avatarUrl: string;
      sourceUrl?: string;
    }) => string)
  | undefined;

const getNextWorldDisplaySerial = akyoEntryModule.getNextWorldDisplaySerial as
  | ((
      entries: { entryType?: "avatar" | "world"; displaySerial?: string }[],
    ) => string)
  | undefined;
const ensureWorldCategory = akyoEntryModule.ensureWorldCategory as
  | ((categories: string[]) => string[])
  | undefined;
const extractVRChatAvatarIdFromUrl =
  akyoEntryModule.extractVRChatAvatarIdFromUrl as
    | ((url: string | undefined) => string | null)
    | undefined;
const extractVRChatWorldIdFromUrl =
  akyoEntryModule.extractVRChatWorldIdFromUrl as
    | ((url: string | undefined) => string | null)
    | undefined;
const shouldResetWorldMetadata = akyoEntryModule.shouldResetWorldMetadata as
  | ((previousUrl: string, nextUrl: string) => boolean)
  | undefined;
const resolveDisplaySerialForEntryUpdate =
  akyoEntryModule.resolveDisplaySerialForEntryUpdate as
    | ((args: {
        entryType: "avatar" | "world";
        id: string;
        nextWorldDisplaySerial: string;
        currentDisplaySerial?: string;
        originalDisplaySerial?: string;
        originalEntryType?: "avatar" | "world";
      }) => string)
    | undefined;

test("resolveDisplaySerialForSourceUrlChange resets stale world serials for avatar URLs", () => {
  assert.equal(typeof resolveDisplaySerialForSourceUrlChange, "function");

  assert.equal(
    resolveDisplaySerialForSourceUrlChange?.({
      currentDisplaySerial: "0042",
      detectedEntryType: "avatar",
      id: "0746",
    }),
    "0746",
  );
});

test("resolveDisplaySerialForSourceUrlChange preserves serials for world or unknown URLs", () => {
  assert.equal(typeof resolveDisplaySerialForSourceUrlChange, "function");

  assert.equal(
    resolveDisplaySerialForSourceUrlChange?.({
      currentDisplaySerial: "0042",
      detectedEntryType: "world",
      id: "0746",
    }),
    "0042",
  );
  assert.equal(
    resolveDisplaySerialForSourceUrlChange?.({
      currentDisplaySerial: "0042",
      detectedEntryType: null,
      id: "0746",
    }),
    "0042",
  );
});

test("getPublicDisplayId formats avatar and world public ids independently", () => {
  assert.equal(typeof getPublicDisplayId, "function");

  assert.equal(
    getPublicDisplayId?.({
      id: "0746",
      entryType: "avatar",
      displaySerial: "0746",
      appearance: "",
      nickname: "Avatar Akyo",
      avatarName: "Avatar Akyo",
      category: "",
      comment: "",
      author: "",
      attribute: "",
      notes: "",
      creator: "",
      avatarUrl: "https://vrchat.com/home/avatar/avtr_example",
      sourceUrl: "https://vrchat.com/home/avatar/avtr_example",
    }),
    "Avatar0746",
  );

  assert.equal(
    getPublicDisplayId?.({
      id: "0799",
      entryType: "world",
      displaySerial: "0003",
      appearance: "",
      nickname: "World Akyo",
      avatarName: "",
      category: "ワールド",
      comment: "",
      author: "",
      attribute: "ワールド",
      notes: "",
      creator: "",
      avatarUrl: "https://vrchat.com/home/world/wrld_example",
      sourceUrl: "https://vrchat.com/home/world/wrld_example",
    }),
    "World0003",
  );
});

test("getNextWorldDisplaySerial appends after the highest existing world serial", () => {
  assert.equal(typeof getNextWorldDisplaySerial, "function");

  assert.equal(
    getNextWorldDisplaySerial?.([
      { entryType: "avatar", displaySerial: "0746" },
      { entryType: "world", displaySerial: "0001" },
      { entryType: "world", displaySerial: "0012" },
      { entryType: "world", displaySerial: "0007" },
    ]),
    "0013",
  );
});

test("getNextWorldDisplaySerial ignores invalid or missing world serials", () => {
  assert.equal(typeof getNextWorldDisplaySerial, "function");

  assert.equal(
    getNextWorldDisplaySerial?.([
      { entryType: "avatar", displaySerial: "0746" },
      { entryType: "world", displaySerial: "" },
      { entryType: "world" },
      { entryType: "world", displaySerial: "not-a-number" },
    ]),
    "0001",
  );
});

test("resolveDisplaySerialForSourceUrlChange restores the original world serial after toggling back from avatar", () => {
  assert.equal(typeof resolveDisplaySerialForSourceUrlChange, "function");

  assert.equal(
    resolveDisplaySerialForSourceUrlChange?.({
      currentDisplaySerial: "0746",
      detectedEntryType: "world",
      id: "0746",
      originalDisplaySerial: "0042",
      originalEntryType: "world",
    }),
    "0042",
  );
});

test("extractVRChatAvatarIdFromUrl keeps valid avatar ids that end with a hyphen", () => {
  assert.equal(typeof extractVRChatAvatarIdFromUrl, "function");

  assert.equal(
    extractVRChatAvatarIdFromUrl?.("avtr_abc-def-"),
    "avtr_abc-def-",
  );
  assert.equal(
    extractVRChatAvatarIdFromUrl?.("https://vrchat.com/home/avatar/avtr_abc-def-"),
    "avtr_abc-def-",
  );
});

test("extractVRChatWorldIdFromUrl keeps valid world ids that end with a hyphen", () => {
  assert.equal(typeof extractVRChatWorldIdFromUrl, "function");

  assert.equal(
    extractVRChatWorldIdFromUrl?.("wrld_abc-def-"),
    "wrld_abc-def-",
  );
  assert.equal(
    extractVRChatWorldIdFromUrl?.("https://vrchat.com/home/world/wrld_abc-def-"),
    "wrld_abc-def-",
  );
});

test("ensureWorldCategory prepends the world marker exactly once", () => {
  assert.equal(typeof ensureWorldCategory, "function");

  assert.deepEqual(ensureWorldCategory?.(["ワールド/ペデスタル"]), [
    "ワールド",
    "ワールド/ペデスタル",
  ]);
  assert.deepEqual(
    ensureWorldCategory?.(["ワールド", "ワールド/ペデスタル", "ワールド"]),
    ["ワールド", "ワールド/ペデスタル"],
  );
});

test("shouldResetWorldMetadata only resets when the target world URL actually changes", () => {
  assert.equal(typeof shouldResetWorldMetadata, "function");

  assert.equal(
    shouldResetWorldMetadata?.(
      "https://vrchat.com/home/world/wrld_original",
      "https://vrchat.com/home/world/wrld_updated",
    ),
    true,
  );
  assert.equal(
    shouldResetWorldMetadata?.(
      "https://vrchat.com/home/world/wrld_original",
      "https://vrchat.com/home/world/wrld_original",
    ),
    false,
  );
  assert.equal(
    shouldResetWorldMetadata?.(
      "https://vrchat.com/home/world/wrld_original",
      "https://vrchat.com/home/avatar/avtr_updated",
    ),
    false,
  );
});

test("resolveDisplaySerialForEntryUpdate allocates a fresh world serial for avatar conversions", () => {
  assert.equal(typeof resolveDisplaySerialForEntryUpdate, "function");

  assert.equal(
    resolveDisplaySerialForEntryUpdate?.({
      entryType: "world",
      id: "0900",
      currentDisplaySerial: "0900",
      originalEntryType: "avatar",
      nextWorldDisplaySerial: "0002",
    }),
    "0002",
  );

  assert.equal(
    resolveDisplaySerialForEntryUpdate?.({
      entryType: "world",
      id: "0746",
      currentDisplaySerial: "",
      originalDisplaySerial: "0001",
      originalEntryType: "world",
      nextWorldDisplaySerial: "0002",
    }),
    "0001",
  );
});

test("detectVrcEntryTypeFromUrl accepts tab suffixes like /info from copied browser URLs", () => {
  const detect = (akyoEntryModuleNs as Record<string, unknown>)
    .detectVrcEntryTypeFromUrl as (url: string) => string | null;
  const extractWorld = (akyoEntryModuleNs as Record<string, unknown>)
    .extractVRChatWorldIdFromUrl as (url: string) => string | null;

  // VRChat公式サイトの詳細ページはタブUIで、コピーしたURLに /info が付く
  assert.equal(
    detect("https://vrchat.com/home/world/wrld_12ab34cd-1a2b-3c4d-5e6f-abcdef123456/info"),
    "world",
  );
  assert.equal(
    detect("https://vrchat.com/home/avatar/avtr_471f82ba-0c0b-4fe5-9f9c-3c7d88ab1921/info"),
    "avatar",
  );
  // 従来形式は不変
  assert.equal(
    detect("https://vrchat.com/home/world/wrld_12ab34cd-1a2b-3c4d-5e6f-abcdef123456"),
    "world",
  );
  // ホストが違えば拒否のまま
  assert.equal(detect("https://evil.example/home/world/wrld_12ab34cd/info"), null);
  // タブサフィックスは1個まで。多重セグメント・空セグメントは拒否
  assert.equal(detect("https://vrchat.com/home/world/wrld_12ab34cd/info/anything"), null);
  assert.equal(detect("https://vrchat.com/home/world/wrld_12ab34cd////"), null);
  // 未知タブでも1セグメントなら許容（将来のタブ追加に追従）
  assert.equal(detect("https://vrchat.com/home/world/wrld_12ab34cd/reviews"), "world");
  // ID抽出は /info 付きでも従来どおり
  assert.equal(
    extractWorld("https://vrchat.com/home/world/wrld_12ab34cd-1a2b-3c4d-5e6f-abcdef123456/info"),
    "wrld_12ab34cd-1a2b-3c4d-5e6f-abcdef123456",
  );
});
