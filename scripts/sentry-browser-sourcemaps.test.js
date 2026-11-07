const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  uploadCommands,
  uploadToSentry,
  removeSourceMaps,
  findLeftoverSourceMaps,
  parseArgs,
} = require("./sentry-browser-sourcemaps");

const RELEASE = "636be8fef64a182f553247ef311482f6fd17c335";
const quietLog = { log() {}, warn() {} };

const createdRoots = [];
test.after(() => {
  for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true });
});

function makeAssets(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "akyodex-sourcemaps-"));
  createdRoots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

const read = (root, name) => fs.readFileSync(path.join(root, name), "utf8");
const exists = (root, name) => fs.existsSync(path.join(root, name));

test("リリース名は git のコミット（40 桁の 16 進）だけを受け付ける", () => {
  assert.equal(parseArgs(["--release", RELEASE]).release, RELEASE);
  for (const bad of [undefined, "636be8fe", RELEASE.toUpperCase(), `${RELEASE}x`, "a1dbf644-0ba2-467d-8b6e-216f1ecadef6"]) {
    assert.throws(() => parseArgs(bad === undefined ? [] : ["--release", bad]), /git のコミット/, String(bad));
  }
});

test("Sentry に上げるファイルの名前は、ブラウザーの SDK が書き換えたスタックの場所に合わせる", () => {
  const [create, upload] = uploadCommands(RELEASE, "assets/_next/static");
  assert.deepEqual(create, ["releases", "new", RELEASE]);
  assert.deepEqual(upload.slice(0, 2), ["sourcemaps", "upload"]);
  assert.equal(upload[upload.indexOf("--release") + 1], RELEASE);
  // sentry-client-init.ts の normalizeNextStackFrame が <origin>/_next/... を app:///_next/... にする
  assert.equal(upload[upload.indexOf("--url-prefix") + 1], "app:///_next/static");
  assert.equal(upload.at(-1), "assets/_next/static");
});

test("トークンなどがなければ上げずに警告だけ出し、sentry-cli を呼ばない", () => {
  const calls = [];
  const warnings = [];
  const uploaded = uploadToSentry(RELEASE, "dir", {
    env: { SENTRY_ORG: "o", SENTRY_PROJECT: "p" },
    run: (args) => calls.push(args),
    log: { warn: (m) => warnings.push(m) },
  });
  assert.equal(uploaded, false);
  assert.deepEqual(calls, []);
  assert.match(warnings[0], /SENTRY_AUTH_TOKEN/);
});

test("sentry-cli が失敗しても例外にせず、上げなかったと返す", () => {
  const warnings = [];
  const uploaded = uploadToSentry(RELEASE, "dir", {
    env: { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" },
    run: (args) => args[0] !== "releases",
    log: { warn: (m) => warnings.push(m) },
  });
  assert.equal(uploaded, false);
  assert.match(warnings[0], /releases new/);
});

test(".map を消し、末尾の参照のコメントだけを消す（途中は触らない）", () => {
  const root = makeAssets({
    "_next/static/chunks/a.js": "console.log(1);\n//# sourceMappingURL=a.js.map",
    "_next/static/chunks/a.js.map": "{}",
    "_next/static/chunks/b.css": "a{color:red}\n/*# sourceMappingURL=b.css.map */",
    "_next/static/chunks/b.css.map": "{}",
    // ライブラリのコードの中の文字列は消さない
    "_next/static/chunks/lib.js": 'const s="//# sourceMappingURL=";\nmodule.exports=s;\n',
    "_next/static/media/font.woff2": "binary",
    "sw.js": "self.x=1;\n",
  });
  const result = removeSourceMaps(root);
  assert.deepEqual(result, { removedMaps: 2, strippedComments: 2 });
  assert.equal(read(root, "_next/static/chunks/a.js"), "console.log(1);");
  assert.equal(read(root, "_next/static/chunks/b.css"), "a{color:red}");
  assert.equal(read(root, "_next/static/chunks/lib.js"), 'const s="//# sourceMappingURL=";\nmodule.exports=s;\n');
  assert.equal(exists(root, "_next/static/chunks/a.js.map"), false);
  assert.deepEqual(findLeftoverSourceMaps(root), []);
});

test("残っている .map と末尾の参照のコメントを見つける", () => {
  const root = makeAssets({
    "_next/static/chunks/a.js": "x;\n//# sourceMappingURL=a.js.map\n",
    "public.map": "{}",
    "_next/static/chunks/lib.js": 'const s="sourceMappingURL=";',
  });
  assert.deepEqual(
    findLeftoverSourceMaps(root).map((f) => path.relative(root, f).replace(/\\/g, "/")).sort(),
    ["_next/static/chunks/a.js", "public.map"]
  );
});

test("main は上げてから消し、上げられなくても配信物の後片付けはする", () => {
  for (const env of [{ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" }, {}]) {
    const root = makeAssets({
      "_next/static/chunks/a.js": "x;\n//# sourceMappingURL=a.js.map",
      "_next/static/chunks/a.js.map": "{}",
    });
    const calls = [];
    const result = main(["--release", RELEASE, "--assets", root], {
      env,
      // 上げる時点では .map がまだあること
      run: (args) => {
        calls.push(args[0]);
        assert.equal(exists(root, "_next/static/chunks/a.js.map"), true);
        return true;
      },
      log: quietLog,
    });
    assert.equal(result.uploaded, Boolean(env.SENTRY_AUTH_TOKEN));
    assert.deepEqual(calls, env.SENTRY_AUTH_TOKEN ? ["releases", "sourcemaps"] : []);
    assert.equal(exists(root, "_next/static/chunks/a.js.map"), false);
    assert.equal(read(root, "_next/static/chunks/a.js"), "x;");
  }
});

test("ソースマップが 1 つもなければ上げずに警告する", () => {
  const root = makeAssets({ "_next/static/chunks/a.js": "x;" });
  const warnings = [];
  const result = main(["--release", RELEASE, "--assets", root], {
    env: { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" },
    run: () => assert.fail("呼ばない"),
    log: { log() {}, warn: (m) => warnings.push(m) },
  });
  assert.equal(result.uploaded, false);
  assert.match(warnings[0], /AKYODEX_BROWSER_SOURCEMAPS/);
});

test("_next/static がなければ失敗する（ビルドの前に走らせた）", () => {
  const root = makeAssets({ "sw.js": "x;" });
  assert.throws(() => main(["--release", RELEASE, "--assets", root], { log: quietLog }), /_next/);
});
