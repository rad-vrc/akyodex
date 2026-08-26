import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import {
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

test("shouldBypassImageOptimization bypasses local API and placeholder paths", () => {
  assert.equal(shouldBypassImageOptimization("/api/vrc-world-image?wrld=wrld_x&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/api/avatar-image?id=0001&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/images/placeholder.webp"), true);
  assert.equal(shouldBypassImageOptimization("https://images.akyodex.com/0001.webp"), false);
});

test("getCatalogCardImageRequestWidth keeps avatars at 384 and requests worlds at 512", () => {
  assert.equal(getCatalogCardImageRequestWidth("avatar"), 384);
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
