import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const modalSource = readFileSync(
  path.join(process.cwd(), "src", "components", "akyo-detail-modal.tsx"),
  "utf8",
);

test("uses the pink-to-orange brand palette instead of purple accents", () => {
  assert.doesNotMatch(modalSource, /\b(?:purple|violet|indigo|fuchsia)-/i);
  assert.match(modalSource, /from-pink-100 via-rose-50 to-orange-100/);
  assert.match(modalSource, /focus-visible:ring-orange-300/);
});

test("keeps the reference image viewer on a neutral solid background", () => {
  assert.match(
    modalSource,
    /h-64 overflow-hidden rounded-3xl bg-gray-100 p-2/,
  );
});
