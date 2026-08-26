import assert from "node:assert/strict";
import test from "node:test";

import {
  createTimingSafeDigest,
  parseAkyoFormData,
  timingSafeCompare,
} from "./api-helpers";

test("timingSafeCompare authenticates equal secrets even without Workers timingSafeEqual", () => {
  assert.equal(timingSafeCompare("shared-secret", "shared-secret"), true);
  assert.equal(timingSafeCompare("shared-secret", "different-secret"), false);
});

test("createTimingSafeDigest returns fixed-length digests for different input lengths", () => {
  const shortDigest = createTimingSafeDigest("a");
  const longDigest = createTimingSafeDigest(
    "this-is-a-much-longer-input-than-the-short-secret",
  );

  assert.equal(shortDigest.byteLength, longDigest.byteLength);
  assert.notDeepEqual([...shortDigest], [...longDigest]);
});

test("parseAkyoFormData rejects world submissions with a non-world source URL", () => {
  const formData = new FormData();
  formData.append("id", "0746");
  formData.append("entryType", "world");
  formData.append("nickname", "Broken World");
  formData.append("author", "Author");
  formData.append("sourceUrl", "https://vrchat.com/home/world/not-a-wrld-id");

  assert.deepEqual(parseAkyoFormData(formData), {
    success: false,
    status: 400,
    error: "entryType と sourceUrl の種別が一致していません",
  });
});

test("parseAkyoFormData rejects avatar submissions with a non-avatar source URL", () => {
  const formData = new FormData();
  formData.append("id", "0746");
  formData.append("entryType", "avatar");
  formData.append("avatarName", "Broken Avatar");
  formData.append("author", "Author");
  formData.append("sourceUrl", "https://vrchat.com/home/world/wrld_abc-def");

  assert.deepEqual(parseAkyoFormData(formData), {
    success: false,
    status: 400,
    error: "entryType と sourceUrl の種別が一致していません",
  });
});

test("parseAkyoFormData rejects avatars without the VRChat avatar name", () => {
  const formData = new FormData();
  formData.append("id", "0746");
  formData.append("entryType", "avatar");
  formData.append("author", "Author");
  formData.append(
    "sourceUrl",
    "https://vrchat.com/home/avatar/avtr_abc-def",
  );

  assert.deepEqual(parseAkyoFormData(formData), {
    success: false,
    status: 400,
    error: "必須フィールドが不足しています",
  });
});

test("parseAkyoFormData rejects worlds without a display name", () => {
  const formData = new FormData();
  formData.append("id", "0746");
  formData.append("entryType", "world");
  formData.append("author", "Author");
  formData.append("sourceUrl", "https://vrchat.com/home/world/wrld_abc-def");

  assert.deepEqual(parseAkyoFormData(formData), {
    success: false,
    status: 400,
    error: "必須フィールドが不足しています",
  });
});
