import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const COMPONENT_FILES = [
  "akyo-card.tsx",
  "akyo-list.tsx",
  "akyo-detail-modal.tsx",
];

test("all category badge surfaces use the shared opaque color tokens", () => {
  COMPONENT_FILES.forEach((fileName) => {
    const source = readFileSync(path.join(__dirname, fileName), "utf8");

    assert.match(source, /getCategoryBadgeColors/, fileName);
    assert.doesNotMatch(source, /ensureContrastOnWhite/, fileName);
    assert.doesNotMatch(source, /ensureContrastForWhiteText/, fileName);
  });
});
