import assert from "node:assert/strict";
import test from "node:test";

import { assertWorldRegistrationAssets } from "./world-registration";

test("assertWorldRegistrationAssets allows registrations without world image (warns only)", () => {
  assert.doesNotThrow(() =>
    assertWorldRegistrationAssets({
      imageFile: null,
      resolvedAuthor: "Author",
      resolvedNickname: "World Name",
    }),
  );
});

test("assertWorldRegistrationAssets rejects registrations without required metadata", () => {
  assert.throws(
    () =>
      assertWorldRegistrationAssets({
        imageFile: {} as File,
        resolvedAuthor: "",
        resolvedNickname: "World Name",
      }),
    /ワールド情報の自動取得が一部不足しました/,
  );
});
