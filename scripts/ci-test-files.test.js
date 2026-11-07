const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// リポジトリにあるテストファイルが、どれかの workflow の `--test` で走ることを確かめる。
// ルートの next.config.test.ts が CI のどこからも走っていなかった（PR #612 で発覚）ので、
// テストを足した場所が CI の対象から漏れたら、ここで落ちて知らせる。

const ROOT = path.resolve(__dirname, "..");

// CI で走らせないことにしているもの。足すときは理由を書く
const NOT_RUN_IN_CI = [
  // #318 の一度きりのデータ移行用スクリプトのテスト（knip でも使い捨てとして除外している）
  /^scripts\/tmp\//,
];

const TEST_FILE = /\.test\.(?:ts|tsx|js|mjs|cjs)$/;

function trackedTestFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter((f) => TEST_FILE.test(f));
}

// workflow の run: から、`npm run <name>` を package.json の中身に展開したうえで
// `tsx --test` / `node --test` に渡しているパスと glob を集める
function ciTestPatterns() {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};
  const workflowDir = path.join(ROOT, ".github", "workflows");
  const commands = [];
  for (const name of fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
    for (const line of fs.readFileSync(path.join(workflowDir, name), "utf8").split(/\r?\n/)) {
      commands.push(line);
      for (const match of line.matchAll(/npm run ([\w:.-]+)/g)) {
        if (scripts[match[1]]) commands.push(scripts[match[1]]);
      }
    }
  }

  const patterns = new Set();
  for (const command of commands) {
    for (const segment of command.split(/&&|\|\||;/)) {
      const match = segment.match(/\b(?:tsx|node)\s+--test\s+(.*)$/);
      if (!match) continue;
      for (const token of match[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []) {
        const value = token.replace(/^["']|["']$/g, "");
        if (!value.startsWith("-")) patterns.add(value);
      }
    }
  }
  return [...patterns];
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

test("workflow の --test に渡しているパスを読み取れる", () => {
  const patterns = ciTestPatterns();
  // 読み取りが壊れて 0 件になると、下のテストが全部の漏れを見逃すので先に確かめる
  for (const expected of ["src/**/*.test.ts", "scripts/*.test.js", "next.config.test.ts"]) {
    assert.ok(patterns.includes(expected), `${expected} が見つからない: ${patterns.join(", ")}`);
  }
});

test("リポジトリのテストファイルはすべて CI のどこかで走る", () => {
  const matchers = ciTestPatterns().map(globToRegExp);
  const missing = trackedTestFiles().filter(
    (file) => !NOT_RUN_IN_CI.some((re) => re.test(file)) && !matchers.some((re) => re.test(file))
  );
  assert.deepEqual(
    missing,
    [],
    "CI のどの --test にも入っていないテストファイルがある。workflow か package.json の test:* に足すか、" +
      "走らせない理由があれば scripts/ci-test-files.test.js の NOT_RUN_IN_CI に理由つきで足す"
  );
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
