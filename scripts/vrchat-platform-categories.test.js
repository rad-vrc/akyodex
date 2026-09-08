const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = (name) =>
  import(pathToFileURL(path.join(__dirname, "vrchat-platforms", name)).href);

// ── 付与側 ───────────────────────────────────────────────────────────

test("adds the platform categories to a row that has none", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  assert.equal(
    mergePlatformCategories("チョコミント類,Booth", ["standalonewindows", "android"]),
    "チョコミント類,Booth,対応機種,対応機種/PC,対応機種/Quest(Android)",
  );
});

test("adds iOS only when the real build has it", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  assert.equal(
    mergePlatformCategories("動物", ["android", "ios", "standalonewindows"]),
    "動物,対応機種,対応機種/PC,対応機種/Quest(Android),対応機種/iOS",
  );
  assert.equal(mergePlatformCategories("動物", ["standalonewindows"]), "動物,対応機種,対応機種/PC");
});

/**
 * Codex の指摘 2。追加だけにすると、作者が Quest 版を取り下げたあと取り直しても
 * 古いタグが残る。判定できた行では対応機種配下を置き換える。
 */
test("drops a platform tag when the avatar no longer ships that build", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  const before = "動物,対応機種,対応機種/PC,対応機種/Quest(Android),対応機種/iOS";
  assert.equal(mergePlatformCategories(before, ["standalonewindows"]), "動物,対応機種,対応機種/PC");
});

test("keeps every other category, in order, when replacing the platform tags", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  const before = "動物,対応機種/Quest(Android),動物/きつね,対応機種,Booth,対応機種/PC";
  assert.equal(
    mergePlatformCategories(before, ["standalonewindows", "android"]),
    "動物,動物/きつね,Booth,対応機種,対応機種/PC,対応機種/Quest(Android)",
  );
});

test("leaves the row untouched when the platform could not be judged", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  // 取得失敗を「対応終了」と読み替えて消さない
  const before = "乗り物,対応機種,対応機種/PC,対応機種/Quest(Android)";
  assert.equal(mergePlatformCategories(before, null), before);
  assert.equal(mergePlatformCategories("乗り物", null), "乗り物");
});

test("is idempotent", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  const once = mergePlatformCategories("動物", ["standalonewindows", "android"]);
  assert.equal(mergePlatformCategories(once, ["standalonewindows", "android"]), once);
});

test("round-trips a CSV row whose comment contains a newline", async () => {
  const { parseCsv, serializeCsv } = await load("apply-platform-categories.mjs");
  const source = '"ID","Category","Comment"\n"0732","動物","一行目\n二行目"\n';
  const rows = parseCsv(source);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], "一行目\n二行目");
  assert.equal(serializeCsv(rows, "\n"), source);
});

// ── 取得側 ───────────────────────────────────────────────────────────

/**
 * Codex の指摘 1。成功済みの記録が無期限に飛ばされると、作者が後から Quest 版を
 * 上げても取り込めない。--refresh で取り直せること。
 */
test("skips finished records by default so an interrupted run can resume", async () => {
  const { selectTargets } = await load("fetch-platforms.mjs");
  const targets = [
    { id: "avtr_a", kind: "avatar" },
    { id: "avtr_b", kind: "avatar" },
  ];
  const results = { avtr_a: { schema: 2, status: 200, platforms: ["standalonewindows"] } };
  assert.deepEqual(selectTargets(targets, results).map((t) => t.id), ["avtr_b"]);
});

test("--refresh re-fetches records that already succeeded", async () => {
  const { selectTargets } = await load("fetch-platforms.mjs");
  const targets = [
    { id: "avtr_a", kind: "avatar" },
    { id: "avtr_b", kind: "avatar" },
  ];
  const results = {
    avtr_a: { schema: 2, status: 200, platforms: ["standalonewindows"] },
    avtr_b: { schema: 2, status: 200, platforms: ["standalonewindows", "android"] },
  };
  assert.deepEqual(
    selectTargets(targets, results, { refresh: true }).map((t) => t.id),
    ["avtr_a", "avtr_b"],
  );
});

test("always re-fetches old-format and failed records", async () => {
  const { selectTargets } = await load("fetch-platforms.mjs");
  const targets = [
    { id: "avtr_old", kind: "avatar" },
    { id: "avtr_neterr", kind: "avatar" },
    { id: "avtr_404", kind: "avatar" },
  ];
  const results = {
    avtr_old: { status: 200, platforms: ["android"] }, // schema なし＝impostor 除外前
    avtr_neterr: { schema: 2, status: 0, error: "boom" },
    avtr_404: { schema: 2, status: 404 },
  };
  const picked = selectTargets(targets, results).map((t) => t.id);
  assert.ok(picked.includes("avtr_old"), "古い形式は取り直す");
  assert.ok(picked.includes("avtr_neterr"), "通信失敗は取り直す");
  assert.ok(!picked.includes("avtr_404"), "404 は非公開なので再開時は飛ばす");
});
