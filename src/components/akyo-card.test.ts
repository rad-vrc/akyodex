import assert from "node:assert/strict";
import test from "node:test";

import {
  getCatalogCardPrimaryImageSrc,
  getCatalogCardImageRequestWidth,
  shouldBypassImageOptimization,
} from "./akyo-card";

test("shouldBypassImageOptimization bypasses local API and placeholder paths", () => {
  assert.equal(shouldBypassImageOptimization("/api/vrc-world-image?wrld=wrld_x&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/api/avatar-image?id=0001&w=512"), true);
  assert.equal(shouldBypassImageOptimization("/images/placeholder.webp"), true);
  assert.equal(shouldBypassImageOptimization("https://images.akyodex.com/0001.webp"), false);
});

test("getCatalogCardImageRequestWidth returns 384 for all entry types", () => {
  assert.equal(getCatalogCardImageRequestWidth("avatar"), 384);
  assert.equal(getCatalogCardImageRequestWidth("world"), 384);
});

test("getCatalogCardPrimaryImageSrc uses the stable Akyo id instead of displaySerial", () => {
  assert.equal(
    getCatalogCardPrimaryImageSrc(
      {
        id: "0826",
        displaySerial: "0755",
      },
      false,
      "https://images.akyodex.com",
    ),
    "https://images.akyodex.com/0826.webp",
  );
});
