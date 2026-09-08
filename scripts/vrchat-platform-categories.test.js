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

/**
 * Codex の指摘 3。クッキーが切れるとワールドは 401 ではなく 200 ＋ 空の
 * unityPackages を返す。開始前のアバター検査はその 1 件しか保証しないので、
 * 途中で切れた分は 200 のまま実ビルドが空で記録される。これを「対応終了」と
 * 読み替えると、確認できていないのに Quest / iOS タグを消してしまう。
 */
test("treats a 200 with no real build as unjudged, not as support ending", async () => {
  const { realPlatformsOf } = await load("record.mjs");
  assert.equal(realPlatformsOf({ status: 200, platforms: [] }), null);
  assert.equal(realPlatformsOf({ status: 200 }), null); // platforms ごと欠落
  assert.equal(realPlatformsOf({ status: 404 }), null);
  assert.equal(realPlatformsOf(undefined), null);
  assert.deepEqual(realPlatformsOf({ status: 200, platforms: ["android"] }), ["android"]);
});

test("keeps the existing platform tags when the record is a 200 with no real build", async () => {
  const { mergePlatformCategories } = await load("apply-platform-categories.mjs");
  const { realPlatformsOf } = await load("record.mjs");
  const before = "動物,対応機種,対応機種/PC,対応機種/Quest(Android),対応機種/iOS";
  // 付与スクリプトが record から判定を取り出す経路をそのまま通す
  const judged = realPlatformsOf({ kind: "world", schema: 2, status: 200, platforms: [], packageCount: 0 });
  assert.equal(mergePlatformCategories(before, judged), before);
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

test("never overwrites a good record with a 200 that has no real build", async () => {
  const { keepPreviousReason } = await load("fetch-platforms.mjs");
  const good = { kind: "world", schema: 2, status: 200, platforms: ["standalonewindows", "android"] };
  const empty = { schema: 2, status: 200, platforms: [], packageCount: 0 };

  // クッキーが途中で切れたときに良い記録を潰さない
  assert.equal(keepPreviousReason(good, empty), "200 だが実ビルドが空だった");
  // オーナー申告も同じく守る
  assert.equal(keepPreviousReason({ source: "manual — 申告", status: 200, platforms: ["standalonewindows"] }, empty), "200 だが実ビルドが空だった");
  assert.equal(keepPreviousReason({ source: "manual — 申告", status: 200 }, { status: 404 }), "404 だったが手入力の記録がある");

  // 初回取得は記録する（判定できなかったことも情報なので残す）
  assert.equal(keepPreviousReason(undefined, empty), null);
  // 実ビルドが取れたときは当然上書きする
  assert.equal(keepPreviousReason(good, { status: 200, platforms: ["standalonewindows"] }), null);
  // 404 は API が明確に「無い」と答えているので上書きしてよい
  assert.equal(keepPreviousReason(good, { status: 404 }), null);
});

/** 200 ＋ 空を成功として確定させると、二度と取り直さなくなる。 */
test("always re-fetches a 200 that came back with no real build", async () => {
  const { selectTargets } = await load("fetch-platforms.mjs");
  const targets = [
    { id: "wrld_empty", kind: "world" },
    { id: "wrld_ok", kind: "world" },
  ];
  const results = {
    wrld_empty: { schema: 2, status: 200, platforms: [], packageCount: 0 },
    wrld_ok: { schema: 2, status: 200, platforms: ["standalonewindows"], packageCount: 4 },
  };
  assert.deepEqual(selectTargets(targets, results).map((t) => t.id), ["wrld_empty"]);
});
