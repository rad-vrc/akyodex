import assert from "node:assert/strict";
import test from "node:test";

import * as addTabImageModuleNs from "./add-tab-image";

const addTabImageModule =
  (addTabImageModuleNs as { default?: Record<string, unknown> }).default ??
  (addTabImageModuleNs as Record<string, unknown>);

const resolveCropSourceImage = addTabImageModule.resolveCropSourceImage as
  | ((latestLoadedImageSrc: string | null, previewImageSrc: string | null) => string | null)
  | undefined;

test("resolveCropSourceImage prefers the freshly loaded image over stale preview state", () => {
  assert.equal(typeof resolveCropSourceImage, "function");

  assert.equal(
    resolveCropSourceImage?.("data:image/webp;base64,new", "data:image/webp;base64,old"),
    "data:image/webp;base64,new",
  );
});

test("resolveCropSourceImage falls back to the current preview when no fresh image is available", () => {
  assert.equal(typeof resolveCropSourceImage, "function");

  assert.equal(
    resolveCropSourceImage?.(null, "data:image/webp;base64,old"),
    "data:image/webp;base64,old",
  );
});
