const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// リポジトリにあるテストファイルが、PR の CI（.github/workflows/ci.yml）で走ることを確かめる。
// ルートの next.config.test.ts が CI のどこからも走っていなかった（PR #612 で発覚）ので、
// テストを足した場所が CI の対象から漏れたら、ここで落ちて知らせる。
//
// このファイル自身は ci.yml の専用の段でも名指しで走らせる。glob の段だけだと、
// "scripts/*.test.js" を外したときに、このテストも一緒に外れて気づけないため。
//
// 読める書き方は限っている。読めない書き方では対象のファイルが「走らない」扱いになり、
// このテストが落ちる（黙って通ることはない）。
// - 数えるのは ci.yml だけ。本番のデプロイなど、PR で走らない workflow は数えない
// - `if:` のある job・段、`continue-on-error: true` の段、`working-directory:` のある段は数えない
// - コメントの行は読まない。行末の `\` で続けた行はつなげて読む
// - `tsx --test` / `node --test` の引数を読む。`npm run <name>` は package.json の中身に展開する（入れ子も）
// - glob は `**/` と `*` だけ

const ROOT = path.resolve(__dirname, "..");
const CI_WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

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

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// ci.yml の各 job の段から、実際に PR で走って失敗が CI を止める run: の中身を取り出す
function blockingRunCommands(yaml) {
  const lines = yaml
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"));

  const commands = [];
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.notEqual(jobsStart, -1, "ci.yml に jobs: がない");

  // job は 2 文字下げ、job の設定は 4 文字下げ、段は 6 文字下げの "- "、段の設定は 8 文字下げ
  let jobConditional = false;
  let step = null;
  const flush = () => {
    if (step && !jobConditional && !step.skip && step.run !== undefined) commands.push(step.run);
    step = null;
  };
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent === 2) {
      flush();
      jobConditional = false;
      continue;
    }
    if (indent === 4) {
      flush();
      if (/^\s+if:/.test(line)) jobConditional = true;
      continue;
    }
    if (indent === 6 && line.trimStart().startsWith("- ")) {
      flush();
      step = { skip: false, run: undefined };
    }
    if (!step) continue;

    // 段の最初の行（"- run: ..."）と、8 文字下げの設定の行を同じに扱う
    const property = line.trimStart().replace(/^- /, "");
    if (indent === 6 || indent === 8) {
      if (/^if:/.test(property) || /^working-directory:/.test(property)) step.skip = true;
      if (/^continue-on-error:\s*true\s*$/.test(property)) step.skip = true;
      const run = property.match(/^run:\s*(.*)$/);
      if (run) {
        if (/^[|>][-+]?\s*$/.test(run[1])) {
          const body = [];
          while (i + 1 < lines.length && (lines[i + 1].trim() === "" || indentOf(lines[i + 1]) > 8)) {
            body.push(lines[++i].trim());
          }
          step.run = body.join("\n");
        } else {
          step.run = run[1];
        }
      }
    }
  }
  flush();
  return commands;
}

function expandNpmRun(command, scripts, depth = 0) {
  assert.ok(depth < 5, `npm run の入れ子が深すぎる: ${command}`);
  const expanded = [command];
  for (const match of command.matchAll(/npm run ([\w:.-]+)/g)) {
    if (scripts[match[1]]) expanded.push(...expandNpmRun(scripts[match[1]], scripts, depth + 1));
  }
  return expanded;
}

function testPatternsIn(command) {
  const patterns = [];
  for (const segment of command.replace(/\\\r?\n/g, " ").split(/&&|\|\||;|\n/)) {
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
  const commands = blockingRunCommands(fs.readFileSync(CI_WORKFLOW, "utf8"));
  return [...new Set(commands.flatMap((c) => expandNpmRun(c, scripts)).flatMap(testPatternsIn))];
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
    "scripts/ci-test-files.test.js",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} がない（このテストの例を直す）`);
    assert.ok(covers(patterns, file), `${file} を走らせる段が読めない: ${patterns.join(", ")}`);
  }
});

test("このテスト自身は glob に頼らず、ci.yml の専用の段で走る", () => {
  const commands = blockingRunCommands(fs.readFileSync(CI_WORKFLOW, "utf8"));
  assert.ok(
    commands.some((c) => testPatternsIn(c).includes("scripts/ci-test-files.test.js")),
    "ci.yml に node --test scripts/ci-test-files.test.js の段がない"
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
      "走らせない理由があれば scripts/ci-test-files.test.js の NOT_RUN_IN_CI に理由つきで足す"
  );
});

test("ci.yml の読み取りは、走らない段・コメントを数えない", () => {
  const yaml = [
    "on: pull_request",
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: counted",
    "        run: npx tsx --test one.test.ts",
    "      - run: node --test two.test.js",
    "      - name: block",
    "        run: |",
    "          echo start",
    "          npx tsx --test \\",
    "            three.test.ts",
    "      # - run: npx tsx --test commented.test.ts",
    "      - name: conditional",
    "        if: ${{ false }}",
    "        run: npx tsx --test conditional.test.ts",
    "      - name: advisory",
    "        run: npx tsx --test advisory.test.ts",
    "        continue-on-error: true",
    "      - name: elsewhere",
    "        working-directory: sub",
    "        run: npx tsx --test sub.test.ts",
    "  b:",
    "    if: github.event_name == 'push'",
    "    steps:",
    "      - run: npx tsx --test push-only.test.ts",
  ].join("\n");
  const patterns = blockingRunCommands(yaml).flatMap(testPatternsIn);
  assert.deepEqual(patterns.sort(), ["one.test.ts", "three.test.ts", "two.test.js"]);
});

test("npm run は入れ子も展開する", () => {
  const scripts = { outer: "npm run inner && echo ok", inner: "tsx --test inner.test.ts" };
  assert.deepEqual(expandNpmRun("npm run outer", scripts).flatMap(testPatternsIn), ["inner.test.ts"]);
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
