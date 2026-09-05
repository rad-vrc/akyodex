import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AkyoData } from "@/types/akyo";
import {
  AkyoCard,
  getCatalogCardPrimaryImageSrc,
  getCatalogCardImageRequestWidth,
  shouldBypassImageOptimization,
} from "./akyo-card";
import * as akyoCardModuleNs from "./akyo-card";

const akyoCardModule =
  (akyoCardModuleNs as { default?: Record<string, unknown> }).default ??
  (akyoCardModuleNs as Record<string, unknown>);
const shouldPrioritizeCatalogCardImage =
  akyoCardModule.shouldPrioritizeCatalogCardImage as
  | ((index: number) => boolean)
  | undefined;
const getCatalogAvatarCardImageSrc =
  akyoCardModule.getCatalogAvatarCardImageSrc as
  | ((akyo: Pick<AkyoData, "id">) => string)
  | undefined;

test("shouldBypassImageOptimization bypasses local API, placeholder, and direct R2 paths", () => {
  assert.equal(shouldBypassImageOptimization("/api/vrc-world-image?wrld=wrld_x&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/api/avatar-image?id=0001&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/images/placeholder.webp"), true);
  assert.equal(shouldBypassImageOptimization("https://images.akyodex.com/0001.webp"), true);
  assert.equal(
    shouldBypassImageOptimization(
      "https://catalog-assets.example/0001.webp",
      "https://catalog-assets.example/",
    ),
    true,
  );
});

test("getCatalogCardImageRequestWidth requests avatars at 768 and worlds at 512", () => {
  assert.equal(getCatalogCardImageRequestWidth("avatar"), 768);
  assert.equal(getCatalogCardImageRequestWidth("world"), 512);
});

test("shouldPrioritizeCatalogCardImage prioritizes only the first catalog image", () => {
  assert.equal(typeof shouldPrioritizeCatalogCardImage, "function");
  assert.equal(shouldPrioritizeCatalogCardImage?.(0), true);
  assert.equal(shouldPrioritizeCatalogCardImage?.(1), false);
  assert.equal(shouldPrioritizeCatalogCardImage?.(2), false);
});

test("getCatalogCardPrimaryImageSrc uses the stable Akyo id instead of displaySerial", () => {
  const akyo: Pick<AkyoData, "id"> = { id: "0826" };

  assert.equal(
    getCatalogCardPrimaryImageSrc(akyo, false, "https://images.akyodex.com"),
    "https://images.akyodex.com/0826.webp",
  );
});

test("getCatalogAvatarCardImageSrc requests the fixed 768px transformation by stable id", () => {
  assert.equal(typeof getCatalogAvatarCardImageSrc, "function");
  assert.equal(
    getCatalogAvatarCardImageSrc?.({ id: "0826" }),
    "/api/avatar-image?id=0826&w=768",
  );
});

test("aligns the detail action to the bottom of stretched catalog cards", () => {
  const akyo: AkyoData = {
    id: "0001",
    entryType: "avatar",
    appearance: "",
    nickname: "Test Akyo",
    avatarName: "Test Avatar",
    sourceUrl: "https://vrchat.com/home/avatar/avtr_test",
    category: "動物,動物/きつね",
    comment: "",
    author: "Test Author",
    attribute: "動物,動物/きつね",
    notes: "",
    creator: "Test Author",
    avatarUrl: "https://vrchat.com/home/avatar/avtr_test",
  };

  const markup = renderToStaticMarkup(
    createElement(AkyoCard, {
      akyo,
      lang: "ja",
    }),
  );

  assert.match(markup, /class="akyo-card relative flex h-full flex-col"/);
  assert.match(markup, /class="flex flex-1 flex-col gap-2 p-4"/);
  assert.match(markup, /class="detail-button[^\"]*\bmt-auto\b/);
});

test("orders author metadata before categories and the detail action", () => {
  const akyo: AkyoData = {
    id: "0001",
    entryType: "avatar",
    appearance: "",
    nickname: "Test Akyo",
    avatarName: "Test Avatar",
    sourceUrl: "https://vrchat.com/home/avatar/avtr_test",
    category: "動物,動物/きつね",
    comment: "",
    author: "Test Author",
    attribute: "動物,動物/きつね",
    notes: "",
    creator: "Test Author",
    avatarUrl: "https://vrchat.com/home/avatar/avtr_test",
  };

  const markup = renderToStaticMarkup(
    createElement(AkyoCard, {
      akyo,
      lang: "ja",
    }),
  );

  const authorPosition = markup.indexOf("Test Author");
  const categoryPosition = markup.indexOf("category-badge");
  const detailPosition = markup.indexOf("detail-button");

  assert.notEqual(authorPosition, -1);
  assert.notEqual(categoryPosition, -1);
  assert.notEqual(detailPosition, -1);
  assert.ok(authorPosition < categoryPosition);
  assert.ok(categoryPosition < detailPosition);
});
