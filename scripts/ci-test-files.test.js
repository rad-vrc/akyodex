const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");

// リポジトリにあるテストファイルが、PR の CI（.github/workflows/ci.yml）のどれかの `--test` で走ることを確かめる。
// ルートの next.config.test.ts が CI のどこからも走っていなかった（PR #612 で発覚）ので、
// テストを足した場所が CI の対象から漏れたら、ここで落ちて知らせる。
//
// このファイル自身は ci.yml の専用の段でも名指しで走らせる。glob の段だけだと、
// "scripts/*.test.js" を外したときに、このテストも一緒に外れて気づけないため。
//
// ci.yml は YAML として読み、各段の run から `tsx --test` / `node --test` の引数を集める
// （`npm run <name>` は package.json の中身に展開する）。glob は `**/` と `*` だけを扱う。

const ROOT = path.resolve(__dirname, "..");
const WATCHDOG_COMMAND = "node --test scripts/ci-test-files.test.js";

// CI で走らせないことにしているもの。足すときは理由を書く
const NOT_RUN_IN_CI = [
  // #318 の一度きりのデータ移行用スクリプトのテスト（knip でも使い捨てとして除外している）
  /^scripts\/tmp\//,
];

function trackedTestFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter((f) => /\.test\.(?:ts|tsx|js|mjs|cjs)$/.test(f));
}

function ciRunCommands() {
  const doc = YAML.parse(fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8"));
  return Object.values(doc.jobs).flatMap((job) => (job.steps ?? []).map((step) => step.run).filter(Boolean));
}

/** `npm run <name>` を package.json の中身に置き換えたものも並べる（入れ子も） */
function expandNpmRun(command, scripts, depth = 0) {
  const expanded = [command];
  if (depth > 5) return expanded;
  for (const match of command.matchAll(/npm run ([\w:.-]+)/g)) {
    if (scripts[match[1]]) expanded.push(...expandNpmRun(scripts[match[1]], scripts, depth + 1));
  }
  return expanded;
}

function testPatternsIn(command) {
  const patterns = [];
  for (const segment of command.replace(/\\\r?\n/g, " ").split(/&&|;|\n/)) {
    const match = segment.match(/\b(?:tsx|node)\s+--test\s+(.*)$/);
    if (!match) continue;
    for (const token of match[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []) {
      const value = token.replace(/^["']|["']$/g, "");
      if (!value.startsWith("-")) patterns.push(value);
    }
  }
  return patterns;
}

function ciTestPatterns() {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};
  return ciRunCommands().flatMap((command) => expandNpmRun(command, scripts)).flatMap(testPatternsIn);
}

// node --test が受け付ける glob のうち、ここで使っている `**/` と `*` だけを扱う
function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob[i] === "*") {
      source += "[^/]*";
    } else {
      source += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

const covers = (patterns, file) => patterns.map(globToRegExp).some((re) => re.test(file));

test("ci.yml の --test に渡しているパスを読み取れる", () => {
  const patterns = ciTestPatterns();
  // 読み取りが壊れて 0 件になると、下のテストが全部の漏れを見逃すので、置き場所ごとに確かめる
  for (const file of [
    "src/lib/sentry-sdk-versions.test.ts",
    "scripts/push-pr-state.test.js",
    "next.config.test.ts",
    "workers/akyo-search-worker/src/search.test.ts",
    "workers/reference-image-generator/src/index.test.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} がない（このテストの例を直す）`);
    assert.ok(covers(patterns, file), `${file} を走らせる段が読めない: ${patterns.join(", ")}`);
  }
});

test("このテスト自身は glob に頼らず、ci.yml の専用の段で走る", () => {
  assert.ok(
    ciRunCommands().some((command) => command.trim() === WATCHDOG_COMMAND),
    `ci.yml に \`${WATCHDOG_COMMAND}\` だけを走らせる段がない`
  );
});

test("リポジトリのテストファイルはすべて PR の CI で走る", () => {
  const patterns = ciTestPatterns();
  const missing = trackedTestFiles().filter(
    (file) => !NOT_RUN_IN_CI.some((re) => re.test(file)) && !covers(patterns, file)
  );
  assert.deepEqual(
    missing,
    [],
    "ci.yml のどの --test にも入っていないテストファイルがある。ci.yml か package.json の test:* に足すか、" +
      "走らせない理由があれば NOT_RUN_IN_CI に理由つきで足す"
  );
});

test("npm run は入れ子も展開し、行末の \\ で続けた行もつなげて読む", () => {
  const scripts = { outer: "npm run inner && echo ok", inner: "tsx --test inner.test.ts" };
  assert.deepEqual(expandNpmRun("npm run outer", scripts).flatMap(testPatternsIn), ["inner.test.ts"]);
  assert.deepEqual(testPatternsIn('npx tsx --test "a/**/*.test.ts" \\\n  b.test.ts'), ["a/**/*.test.ts", "b.test.ts"]);
});

test("glob の読み替えは node --test と同じ範囲を指す", () => {
  const re = globToRegExp("src/**/*.test.ts");
  assert.ok(re.test("src/middleware.test.ts"));
  assert.ok(re.test("src/lib/a/b.test.ts"));
  assert.ok(!re.test("src/lib/a.test.tsx"));
  assert.ok(!re.test("scripts/a.test.ts"));
  assert.ok(globToRegExp("scripts/*.test.js").test("scripts/a.test.js"));
  assert.ok(!globToRegExp("scripts/*.test.js").test("scripts/tmp/a.test.js"));
  assert.ok(globToRegExp("next.config.test.ts").test("next.config.test.ts"));
  assert.ok(!globToRegExp("next.config.test.ts").test("nextXconfig.test.ts"));
});
