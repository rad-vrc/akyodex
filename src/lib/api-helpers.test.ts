import assert from "node:assert/strict";
import test from "node:test";

import {
  createTimingSafeDigest,
  jsonError,
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

test("parseAkyoFormData stores VRChat URLs in canonical form (trailing slash / tab suffix / query removed)", () => {
  const worldId = "wrld_12ab34cd-1a2b-3c4d-5e6f-abcdef123456";
  const worldForm = new FormData();
  worldForm.append("id", "0941");
  worldForm.append("entryType", "world");
  worldForm.append("nickname", "Akyoと一緒の秋");
  worldForm.append("category", "ワールド");
  worldForm.append("author", "Author");
  // 公式サイトのタブUIからコピーした /info 付き＋末尾スラッシュ
  worldForm.append("sourceUrl", `https://vrchat.com/home/world/${worldId}/info/`);

  const world = parseAkyoFormData(worldForm);
  assert.equal(world.success, true, JSON.stringify(world));
  if (world.success) {
    assert.equal(world.data.sourceUrl, `https://vrchat.com/home/world/${worldId}`);
    assert.equal(world.data.avatarUrl, `https://vrchat.com/home/world/${worldId}`);
  }

  const avatarId = "avtr_471f82ba-0c0b-4fe5-9f9c-3c7d88ab1921";
  const avatarForm = new FormData();
  avatarForm.append("id", "0942");
  avatarForm.append("entryType", "avatar");
  avatarForm.append("nickname", "テストAkyo");
  avatarForm.append("avatarName", "Test Akyo");
  avatarForm.append("category", "動物");
  avatarForm.append("author", "Author");
  // 大文字ホスト・http・クエリ・ハッシュ
  avatarForm.append("sourceUrl", `http://VRChat.com/home/avatar/${avatarId}?tab=details#top`);
  // 旧クライアントが avatarUrl を別途送ってきても同じ標準形に揃う
  avatarForm.append("avatarUrl", `https://vrchat.com/home/avatar/${avatarId}/`);

  const avatar = parseAkyoFormData(avatarForm);
  assert.equal(avatar.success, true, JSON.stringify(avatar));
  if (avatar.success) {
    assert.equal(avatar.data.sourceUrl, `https://vrchat.com/home/avatar/${avatarId}`);
    assert.equal(avatar.data.avatarUrl, `https://vrchat.com/home/avatar/${avatarId}`);
  }
});

test("parseAkyoFormData leaves BOOTH-only submissions untouched by URL normalization", () => {
  const formData = new FormData();
  formData.append("id", "0943");
  formData.append("entryType", "booth");
  formData.append("nickname", "BOOTH Akyo");
  formData.append("author", "Author");
  formData.append("boothUrl", "https://booth.pm/ja/items/1234567");

  const result = parseAkyoFormData(formData);
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.sourceUrl, "");
    assert.equal(result.data.boothUrl, "https://booth.pm/ja/items/1234567");
  }
});

test("parseAkyoFormData unifies avatarUrl with the validated sourceUrl even if a client sends a different ID", () => {
  const sourceId = "avtr_11111111-1111-4111-8111-111111111111";
  const otherId = "avtr_22222222-2222-4222-8222-222222222222";
  const formData = new FormData();
  formData.append("id", "0944");
  formData.append("entryType", "avatar");
  formData.append("nickname", "テストAkyo");
  formData.append("avatarName", "Test Akyo");
  formData.append("category", "動物");
  formData.append("author", "Author");
  formData.append("sourceUrl", `https://vrchat.com/home/avatar/${sourceId}/info`);
  // 旧クライアントが別 ID の avatarUrl を併送しても、検証済み sourceUrl に統一される
  formData.append("avatarUrl", `https://vrchat.com/home/avatar/${otherId}/`);

  const result = parseAkyoFormData(formData);
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.sourceUrl, `https://vrchat.com/home/avatar/${sourceId}`);
    assert.equal(result.data.avatarUrl, `https://vrchat.com/home/avatar/${sourceId}`);
  }
});

test("parseAkyoFormData stores the ID from the validated path, not one smuggled in the URL userinfo", () => {
  const realId = "avtr_471f82ba-0c0b-4fe5-9f9c-3c7d88ab1921";
  const formData = new FormData();
  formData.append("id", "0945");
  formData.append("entryType", "avatar");
  formData.append("nickname", "テストAkyo");
  formData.append("avatarName", "Test Akyo");
  formData.append("category", "動物");
  formData.append("author", "Author");
  formData.append(
    "sourceUrl",
    `https://avtr_attacker-0000-0000-0000-000000000000@vrchat.com/home/avatar/${realId}`,
  );

  const result = parseAkyoFormData(formData);
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) {
    assert.equal(result.data.sourceUrl, `https://vrchat.com/home/avatar/${realId}`);
    assert.equal(result.data.avatarUrl, `https://vrchat.com/home/avatar/${realId}`);
  }
});

test("jsonError attaches extra headers such as Retry-After", async () => {
  const response = jsonError("too many", 429, { retryAfterSeconds: 60 }, { "Retry-After": "60" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(await response.json(), { success: false, error: "too many", retryAfterSeconds: 60 });
});
