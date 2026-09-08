const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const fs = require("node:fs/promises");
const os = require("node:os");

const load = (name) =>
  import(pathToFileURL(path.join(__dirname, "vrchat-platforms", name)).href);

/** CLI は進捗を大量に出すので、通しテストのあいだだけ黙らせる。 */
async function quiet(fn) {
  const { log, warn, error } = console;
  Object.assign(console, { log() {}, warn() {}, error() {} });
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

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

test("keeps the previous value but records that this run could not judge it", async () => {
  const { resolveRecord } = await load("fetch-platforms.mjs");
  const good = { kind: "world", schema: 2, status: 200, platforms: ["standalonewindows"], packageCount: 4 };
  const empty = { schema: 2, status: 200, platforms: [], packageCount: 0 };

  // 値は守る。ただし「今回は判定できなかった」も必ず書き残す。これが無いと
  // 付与側が古い成功キャッシュを最新の判定として使ってしまう。
  const kept = resolveRecord(good, empty, "world");
  assert.deepEqual(kept.record.platforms, ["standalonewindows"], "前の値は残す");
  assert.equal(kept.record.unjudged, "200 だが実ビルドが空だった", "判定できなかった事実も残す");
  assert.ok(kept.reason);

  // オーナー申告は API の失敗で無効化しない（API では取れないと分かっているもの）
  const manual = { source: "manual — 申告", schema: 2, status: 200, platforms: ["standalonewindows"] };
  assert.equal(resolveRecord(manual, empty, "avatar").record, manual);
  assert.equal(resolveRecord(manual, { status: 404 }, "avatar").record, manual);

  // 取り直せたら丸ごと差し替わり、unjudged は消える
  const fixed = resolveRecord({ ...good, unjudged: "x" }, { schema: 2, status: 200, platforms: ["android", "standalonewindows"] }, "world");
  assert.equal(fixed.record.unjudged, undefined);
  assert.equal(fixed.reason, null);

  // 404 は API が明確に「無い」と答えているので上書きしてよい
  assert.equal(resolveRecord(good, { status: 404 }, "world").record.status, 404);

  // 初回取得で空だった場合も、判定できなかったこととして記録する
  assert.equal(resolveRecord(undefined, empty, "world").record.unjudged, "200 だが実ビルドが空だった");
});

test("realPlatformsOf ignores a record flagged unjudged even though it still has values", async () => {
  const { realPlatformsOf } = await load("record.mjs");
  const stale = { status: 200, platforms: ["standalonewindows"], unjudged: "200 だが実ビルドが空だった" };
  assert.equal(realPlatformsOf(stale), null);
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

// ── 取得 → 付与 → 再開の通し ─────────────────────────────────────
//
// 関数単位のテストだけだと、各段の出力を次の段に渡したときの抜けを捕まえられない。
// キャッシュと CSV の対応機種が食い違った状態から、3 つの CLI をつないで確かめる。

const PROBE = "avtr_00000000-0000-4000-8000-000000000001";
const SUBJECT = "wrld_00000000-0000-4000-8000-000000000002";

const csvWith = (category) =>
  '"ID","Category","AvatarURL","SourceURL"\n' +
  `"0001","動物","https://vrchat.com/home/avatar/${PROBE}",""\n` +
  `"0002","${category}","","https://vrchat.com/home/world/${SUBJECT}"\n`;

const okBuild = (platforms) => ({
  schema: 2, status: 200, name: "", releaseStatus: "public",
  platforms, impostorPlatforms: [], variants: ["security"], packageCount: platforms.length * 2,
});
/** クッキーが切れたときのワールドの応答。401 ではなく 200 ＋ 空で返る。 */
const emptyBuild = { ...okBuild([]), packageCount: 0 };

test("a refresh that comes back unjudged keeps hand-entered tags and is retried next run", async () => {
  const { main: fetchMain } = await load("fetch-platforms.mjs");
  const { main: applyMain } = await load("apply-platform-categories.mjs");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "akyo-platforms-"));
  const csvPath = path.join(dir, "akyo-data-ja.csv");
  const outPath = path.join(dir, "platforms.json");
  try {
    // 古いキャッシュは PC のみ。そのあと管理画面から Quest 対応を手入力してある。
    await fs.writeFile(outPath, JSON.stringify({
      [PROBE]: { kind: "avatar", ...okBuild(["standalonewindows"]) },
      [SUBJECT]: { kind: "world", ...okBuild(["standalonewindows"]) },
    }));
    const handEntered = "動物,対応機種,対応機種/PC,対応機種/Quest(Android)";
    await fs.writeFile(csvPath, csvWith(handEntered));

    // --refresh の途中でクッキーが切れる。開始前検査（アバター）は通ってしまう。
    await quiet(() => fetchMain({
      csvPath, outPath, cookie: "dummy", refresh: true, gap: () => 0,
      fetcher: async (id) => (id === PROBE ? okBuild(["standalonewindows"]) : emptyBuild),
    }));

    const afterRefresh = JSON.parse(await fs.readFile(outPath, "utf8"));
    assert.deepEqual(afterRefresh[SUBJECT].platforms, ["standalonewindows"], "前の値は残る");
    assert.ok(afterRefresh[SUBJECT].unjudged, "判定できなかったことがファイルに残る");

    // 付与: 判定不能なので触らない。手入力の Quest タグが生き残る。
    await quiet(() => applyMain([csvPath, outPath]));
    const csvAfterApply = await fs.readFile(csvPath, "utf8");
    assert.ok(csvAfterApply.includes(handEntered), `Quest タグが消えた: ${csvAfterApply}`);

    // 再開（--refresh なし）: 成功済みとして飛ばさず取り直す。今度は Quest 版が取れる。
    await quiet(() => fetchMain({
      csvPath, outPath, cookie: "dummy", gap: () => 0,
      fetcher: async (id) =>
        okBuild(id === PROBE ? ["standalonewindows"] : ["android", "standalonewindows"]),
    }));

    const afterResume = JSON.parse(await fs.readFile(outPath, "utf8"));
    assert.equal(afterResume[SUBJECT].unjudged, undefined, "取り直せたら解除される");
    assert.deepEqual(afterResume[SUBJECT].platforms, ["android", "standalonewindows"]);

    // 付与し直すと、今度は取得結果にもとづいて正しく並ぶ
    await quiet(() => applyMain([csvPath, outPath]));
    assert.ok((await fs.readFile(csvPath, "utf8")).includes(handEntered));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
