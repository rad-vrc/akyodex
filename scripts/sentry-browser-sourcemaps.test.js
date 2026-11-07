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
  assertStillParses,
} = require("./sentry-browser-sourcemaps");

const RELEASE = "636be8fef64a182f553247ef311482f6fd17c335";
const quietLog = { log() {}, warn() {} };
const SENTRY_ENV = { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" };

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
const relative = (root, files) => files.map((f) => path.relative(root, f).replace(/\\/g, "/")).sort();
const chunk = (name) => `_next/static/chunks/${name}`;

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
  // .js（末尾のコメントで参照先を示す）と .map の両方を上げる
  const exts = upload.flatMap((value, i) => (upload[i - 1] === "--ext" ? [value] : []));
  assert.deepEqual(exts.sort(), ["js", "map"]);
  assert.equal(upload.at(-1), "assets/_next/static");
});

test("最後の行がまるごと、このビルドの .map を指す参照のコメントのときだけ、その行を消す", () => {
  const root = makeAssets({
    // Turbopack は JS と .map の名前が一致しない（参照先は別の名前）
    [chunk("a.js")]: "console.log(1);\n\n//# sourceMappingURL=other.js.map",
    [chunk("other.js.map")]: "{}",
    [chunk("crlf.js")]: "x;\r\n//# sourceMappingURL=crlf.js.map\r\n",
    [chunk("crlf.js.map")]: "{}",
    [chunk("cr.js")]: "x;\r//# sourceMappingURL=cr.js.map",
    [chunk("cr.js.map")]: "{}",
    [chunk("old.js")]: "y;\n//@ sourceMappingURL=old.js.map",
    [chunk("old.js.map")]: "{}",
    [chunk("b.css")]: "a{color:red}\n/*# sourceMappingURL=b.css.map */\n",
    [chunk("b.css.map")]: "{}",
    // 指す先がこのビルドの .map でなければ触らない
    [chunk("unknown.js")]: "z;\n//# sourceMappingURL=missing.js.map",
    // 同じ行にコードがあれば触らない（行ごと消すとコードまで消える。構文は壊れないので構文の確かめでも捕まらない）
    [chunk("sameline.js")]: "a();\nfoo(); //# sourceMappingURL=other.js.map",
    [chunk("sameline.css")]: "a{b:c}\nd{e:f} /*# sourceMappingURL=b.css.map */",
    // 文字列やテンプレートの中は消さない（最後の行がまるごとコメントではない）
    [chunk("string.js")]: 'const x="//# sourceMappingURL=other.js.map";',
    [chunk("template.js")]: "const t=`hello\n//# sourceMappingURL=other.js.map`;",
    [chunk("css-string.css")]: 'a{content:"/*# sourceMappingURL=b.css.map */"}',
    [chunk("lib.js")]: 'const s="//# sourceMappingURL=";\nmodule.exports=s;\n',
    "_next/static/media/font.woff2": "binary",
    "sw.js": "self.x=1;\n",
  });
  assert.deepEqual(removeSourceMaps(root), { removedMaps: 5, strippedComments: 5 });
  assert.equal(read(root, chunk("a.js")), "console.log(1);\n");
  assert.equal(read(root, chunk("crlf.js")), "x;\n");
  assert.equal(read(root, chunk("cr.js")), "x;\n");
  assert.equal(read(root, chunk("old.js")), "y;\n");
  assert.equal(read(root, chunk("b.css")), "a{color:red}\n");
  assert.equal(read(root, chunk("unknown.js")), "z;\n//# sourceMappingURL=missing.js.map");
  assert.equal(read(root, chunk("sameline.js")), "a();\nfoo(); //# sourceMappingURL=other.js.map");
  assert.equal(read(root, chunk("sameline.css")), "a{b:c}\nd{e:f} /*# sourceMappingURL=b.css.map */");
  assert.equal(read(root, chunk("string.js")), 'const x="//# sourceMappingURL=other.js.map";');
  assert.equal(read(root, chunk("template.js")), "const t=`hello\n//# sourceMappingURL=other.js.map`;");
  assert.equal(read(root, chunk("css-string.css")), 'a{content:"/*# sourceMappingURL=b.css.map */"}');
  assert.equal(read(root, chunk("lib.js")), 'const s="//# sourceMappingURL=";\nmodule.exports=s;\n');
  assert.equal(exists(root, chunk("other.js.map")), false);
  assert.deepEqual(findLeftoverSourceMaps(root), []);
});

test("ソースが漏れる形（.map と最後の行のインラインのソースマップ）を見つける", () => {
  const root = makeAssets({
    "public.map": "{}",
    // 同じ行のコードの後ろでも、インラインのソースマップは見つける
    [chunk("inline.js")]: "throw new Error('x'); //# sourceMappingURL=data:application/json;base64,e30=",
    [chunk("inline.css")]: "a{b:c}\n/*# sourceMappingURL=data:application/json;base64,e30= */\n",
    // 外の .map を指すだけの参照は漏れないので残りにしない
    [chunk("external.js")]: "x;\n//# sourceMappingURL=external.js.map\n",
    // コードの途中の文字列や、テンプレートの中の行は見ない
    [chunk("lib.js")]: 'const s="sourceMappingURL=data:";\nmodule.exports=s;\n',
    [chunk("template.js")]: "const t=`hello\n// # sourceMappingURL=foo`;",
  });
  assert.deepEqual(relative(root, findLeftoverSourceMaps(root)), [chunk("inline.css"), chunk("inline.js"), "public.map"]);
});

test("インラインのソースマップが残っていたら main は失敗する（公開しない）", () => {
  const root = makeAssets({
    [chunk("a.js")]: "throw new Error('x'); //# sourceMappingURL=data:application/json;base64,e30=",
    [chunk("z.js.map")]: "{}",
  });
  assert.throws(
    () => main(["--release", RELEASE, "--assets", root, "--require-maps"], { env: {}, log: quietLog }),
    /ソースマップ（\.map かインラインのもの）が残っている/
  );
});

test("テンプレート文字列の中の参照らしい行では失敗しない", () => {
  const root = makeAssets({
    [chunk("template.js")]: "const x=`hello\n// # sourceMappingURL=foo`;",
    [chunk("template.js.map")]: "{}",
  });
  const result = main(["--release", RELEASE, "--assets", root], { env: {}, log: quietLog });
  assert.equal(result.strippedComments, 0);
  assert.equal(read(root, chunk("template.js")), "const x=`hello\n// # sourceMappingURL=foo`;");
});

test("コメントを消して JS として読めなくなったら失敗する", () => {
  assert.doesNotThrow(() => assertStillParses("x;\n//# sourceMappingURL=a.js.map", "x;\n", "a.js"));
  assert.throws(() => assertStillParses('const x="a";', 'const x="', "a.js"), /読めなくなった/);
  // 元から読めない（モジュールの構文など）ものは比べない
  assert.doesNotThrow(() => assertStillParses("export const x=1;", "export const x=", "m.js"));
});

test("--require-maps は、Sentry に上げる _next/static の中の .map を数える", () => {
  // _next/static に .map がなく、別の場所にだけあるときも失敗する
  for (const files of [{ [chunk("a.js")]: "x;" }, { [chunk("a.js")]: "x;", "unrelated.map": "{}" }]) {
    const root = makeAssets(files);
    assert.throws(
      () => main(["--release", RELEASE, "--assets", root, "--require-maps"], { env: {}, log: quietLog }),
      /1 つもない/
    );
  }
  assert.equal(parseArgs(["--release", RELEASE]).requireMaps, undefined);
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
    env: SENTRY_ENV,
    run: (args) => args[0] !== "releases",
    log: { warn: (m) => warnings.push(m) },
  });
  assert.equal(uploaded, false);
  assert.match(warnings[0], /releases new/);
});

test("main は上げてから消し、上げられなくても配信物の後片付けはする", () => {
  for (const env of [SENTRY_ENV, {}]) {
    const root = makeAssets({
      [chunk("a.js")]: "x;\n//# sourceMappingURL=b.js.map",
      [chunk("b.js.map")]: "{}",
      "outside.map": "{}",
    });
    const calls = [];
    const result = main(["--release", RELEASE, "--assets", root], {
      env,
      // 上げる時点では .map と参照のコメントがまだあること（Sentry は JS の末尾のコメントでマップを探す）
      run: (args) => {
        calls.push(args[0]);
        assert.equal(exists(root, chunk("b.js.map")), true);
        assert.match(read(root, chunk("a.js")), /sourceMappingURL=b\.js\.map/);
        return true;
      },
      log: quietLog,
    });
    assert.equal(result.uploaded, Boolean(env.SENTRY_AUTH_TOKEN));
    assert.equal(result.mapCount, 1, "数えるのは _next/static の中だけ");
    assert.deepEqual(calls, env.SENTRY_AUTH_TOKEN ? ["releases", "sourcemaps"] : []);
    assert.equal(exists(root, chunk("b.js.map")), false);
    assert.equal(exists(root, "outside.map"), false, "_next/static の外の .map も消す");
    assert.equal(read(root, chunk("a.js")), "x;\n");
  }
});

test("ソースマップが 1 つもなければ上げずに警告する", () => {
  const root = makeAssets({ [chunk("a.js")]: "x;" });
  const warnings = [];
  const result = main(["--release", RELEASE, "--assets", root], {
    env: SENTRY_ENV,
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

// workflow がこのスクリプトを正しく呼んでいるか（ビルドでソースマップを作り、ビルドの後・配信の前に、
// 版の印と同じコミットで走らせる。ステージングは --require-maps）
for (const [workflow, build, release, extra, deploy] of [
  ["deploy-cloudflare-workers-production.yml", "npm run build:workers:production", "${GITHUB_SHA}", "", "npx wrangler versions upload"],
  ["deploy-cloudflare-workers-staging.yml", "npm run build:workers", "${PR_HEAD_SHA}", " --require-maps", "npx wrangler deploy"],
]) {
  test(`${workflow} は、ソースマップを作ってビルドし、配信の前にこのスクリプトを走らせる`, () => {
    const yaml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", workflow), "utf8").replace(/\r\n/g, "\n");
    const buildAt = yaml.indexOf(`run: ${build}\n`);
    assert.notEqual(buildAt, -1, "ビルドの段がない");
    // ビルドの段の env に AKYODEX_BROWSER_SOURCEMAPS: '1'（次の段より前）
    const afterBuild = yaml.slice(buildAt, yaml.indexOf("\n      - ", buildAt));
    assert.match(afterBuild, /AKYODEX_BROWSER_SOURCEMAPS: '1'/);
    const command = `run: node scripts/sentry-browser-sourcemaps.js --release "${release}"${extra}\n`;
    const scriptAt = yaml.indexOf(command);
    assert.notEqual(scriptAt, -1, `\`${command.trim()}\` の段がない`);
    const deployAt = yaml.indexOf(deploy);
    assert.ok(buildAt < scriptAt && scriptAt < deployAt, "ビルド → このスクリプト → 配信 の順になっていない");
  });
}
