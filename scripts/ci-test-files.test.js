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
// GitHub Actions とシェルの書き方をすべて読み解くことはしない。決まった形だけを「走る」と数え、
// それ以外の段は数えない。数えない段にしかないテストファイルは「走らない」扱いになって落ちる。
// - 読むのは ci.yml だけ。on: に paths / paths-ignore の絞り込みがあれば落とす（PR によって CI 自体が走らない）
// - job: if・needs・continue-on-error・strategy のどれかがあれば数えない（設定の順番によらない）
// - 段: if・continue-on-error・working-directory・shell のどれかがあれば数えない（値が式でも）
// - run: は 1 行か `run: |` だけ。行末の `\` はつなげる。`run: >` は数えない
// - コマンドは改行か && でつないだものだけ。`||`・`;`・`|`・`&`・`#`・`$`・`` ` ``・`<`・`>`・`set` があれば数えない
// - テストのコマンドは `[npx] tsx --test <パス…>` か `node --test <パス…>` だけ。ほかのオプション
//   （--test-name-pattern など）があれば数えない。`npm run <name>` は package.json の中身を同じ規則で読む（入れ子も）
// - glob は `**/` と `*` だけ

const ROOT = path.resolve(__dirname, "..");
const CI_WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");
const WATCHDOG_COMMAND = "node --test scripts/ci-test-files.test.js";

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

const indentOf = (line) => line.length - line.trimStart().length;
const keyOf = (line) => line.trimStart().replace(/^- /, "").match(/^([\w-]+):/)?.[1];

function readWorkflow(yaml) {
  // コメントだけの行は読まない（コメントの中のコマンドは走らないので、数えないのが正しい）
  const lines = yaml.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#"));

  const onStart = lines.findIndex((line) => /^on:/.test(line));
  const onEnd = lines.findIndex((line, i) => i > onStart && /^\S/.test(line));
  const pathFilters = lines
    .slice(onStart + 1, onEnd === -1 ? undefined : onEnd)
    .filter((line) => /^\s+(paths|paths-ignore):/.test(line));

  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.notEqual(jobsStart, -1, "ci.yml に jobs: がない");

  // job は 2 文字下げ、job の設定は 4 文字下げ、段は 6 文字下げの "- "、段の設定は 8 文字下げ
  const jobs = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (indent === 2) {
      jobs.push({ name: keyOf(line), keys: new Set(), steps: [] });
      continue;
    }
    const job = jobs[jobs.length - 1];
    if (!job) continue;
    if (indent === 4) {
      job.keys.add(keyOf(line));
      continue;
    }
    if (indent === 6 && line.trimStart().startsWith("- ")) job.steps.push({ keys: new Set(), run: undefined });
    const step = job.steps[job.steps.length - 1];
    if (!step || (indent !== 6 && indent !== 8)) continue;
    const key = keyOf(line);
    if (key) step.keys.add(key);
    if (key === "name") step.name = line.trimStart().replace(/^- /, "").replace(/^name:\s*/, "");
    if (key !== "run") continue;
    const value = line.trimStart().replace(/^- /, "").replace(/^run:\s*/, "");
    if (/^\|[-+]?\s*$/.test(value)) {
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === "" || indentOf(lines[i + 1]) > 8)) {
        body.push(lines[++i].trim());
      }
      step.run = body.join("\n");
    } else if (/^[>|]/.test(value)) {
      step.run = null; // 折りたたみなど、数えない形
    } else {
      step.run = value;
    }
  }
  return { pathFilters, jobs };
}

const EXCLUDED_JOB_KEYS = ["if", "needs", "continue-on-error", "strategy"];
const EXCLUDED_STEP_KEYS = ["if", "continue-on-error", "working-directory", "shell"];
const FORBIDDEN = /\|\||;|#|`|\$|[<>]|(?:^|[^&])&(?:[^&]|$)|\|/;
const TEST_COMMAND = /^(?:npx\s+)?(?:tsx|node)\s+--test((?:\s+(?:"[^"]*"|'[^']*'|[^\s'"-][^\s'"]*))+)$/;

// 決まった形なら、そのコマンドが走らせるテストのパスと glob を返す。数えない形なら理由の文字列を返す
function testPatterns(text, scripts, depth = 0) {
  if (depth > 5) return "npm run の入れ子が深すぎる";
  const joined = text.replace(/\\\r?\n/g, " ");
  if (FORBIDDEN.test(joined)) return `数えない記号がある: ${joined}`;
  const patterns = [];
  for (const command of joined.split(/\n|&&/).map((c) => c.trim()).filter(Boolean)) {
    if (/^set\b/.test(command)) return `set がある: ${command}`;
    const npmRun = command.match(/^npm run ([\w:.-]+)$/);
    if (npmRun) {
      const script = scripts[npmRun[1]];
      if (script === undefined) return `package.json に ${npmRun[1]} がない`;
      const inner = testPatterns(script, scripts, depth + 1);
      if (typeof inner === "string") return `npm run ${npmRun[1]}: ${inner}`;
      patterns.push(...inner);
      continue;
    }
    if (!command.includes("--test")) continue;
    const match = command.match(TEST_COMMAND);
    if (!match) return `決まった形でないテストのコマンド: ${command}`;
    for (const token of match[1].match(/"[^"]*"|'[^']*'|\S+/g)) patterns.push(token.replace(/^["']|["']$/g, ""));
  }
  return patterns;
}

// 数える段と、数えない段（理由つき）に分ける
function classifySteps(workflow, scripts) {
  const counted = [];
  const skipped = [];
  for (const job of workflow.jobs) {
    const jobReason = EXCLUDED_JOB_KEYS.find((k) => job.keys.has(k));
    for (const step of job.steps) {
      if (step.run === undefined) continue;
      const label = `${job.name} / ${step.name ?? "(名前なし)"}`;
      const stepReason = EXCLUDED_STEP_KEYS.find((k) => step.keys.has(k));
      const result = step.run === null ? "run: | 以外の複数行" : testPatterns(step.run, scripts);
      const reason = jobReason ? `job に ${jobReason}` : stepReason ? `段に ${stepReason}` : typeof result === "string" ? result : null;
      if (reason) {
        if (step.run && step.run.includes("--test")) skipped.push(`${label}（${reason}）`);
        continue;
      }
      counted.push({ label, run: step.run, patterns: result });
    }
  }
  return { counted, skipped };
}

function loadCi() {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};
  const workflow = readWorkflow(fs.readFileSync(CI_WORKFLOW, "utf8"));
  return { workflow, ...classifySteps(workflow, scripts) };
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

test("ci.yml の on: に paths の絞り込みがない（PR によって CI ごと走らないことがない）", () => {
  assert.deepEqual(loadCi().workflow.pathFilters, []);
});

test("ci.yml の --test に渡しているパスを読み取れる", () => {
  const { counted, skipped } = loadCi();
  const patterns = counted.flatMap((s) => s.patterns);
  // 読み取りが壊れて 0 件になると、下のテストが全部の漏れを見逃すので、置き場所ごとに確かめる
  for (const file of [
    "src/lib/sentry-sdk-versions.test.ts",
    "scripts/push-pr-state.test.js",
    "next.config.test.ts",
    "workers/akyo-search-worker/src/search.test.ts",
    "workers/reference-image-generator/src/index.test.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} がない（このテストの例を直す）`);
    assert.ok(covers(patterns, file), `${file} を走らせる段が読めない。数えなかった段: ${skipped.join(" / ") || "なし"}`);
  }
});

test("このテスト自身は glob に頼らず、ci.yml の専用の段で走る", () => {
  const { counted } = loadCi();
  assert.ok(
    counted.some((s) => s.run.trim() === WATCHDOG_COMMAND),
    `ci.yml に \`${WATCHDOG_COMMAND}\` だけを走らせる段がない`
  );
});

test("リポジトリのテストファイルはすべて PR の CI で走る", () => {
  const { counted, skipped } = loadCi();
  const patterns = counted.flatMap((s) => s.patterns);
  const missing = trackedTestFiles().filter(
    (file) => !NOT_RUN_IN_CI.some((re) => re.test(file)) && !covers(patterns, file)
  );
  assert.deepEqual(
    missing,
    [],
    "ci.yml の数える段のどの --test にも入っていないテストファイルがある。ci.yml か package.json の test:* に" +
      "決まった形で足すか、走らせない理由があれば NOT_RUN_IN_CI に理由つきで足す。" +
      `数えなかった段: ${skipped.join(" / ") || "なし"}`
  );
});

test("ci.yml の読み取りは、走らない・失敗が CI を止めない段を数えない", () => {
  const yaml = [
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: counted",
    "        run: npx tsx --test one.test.ts",
    "      - run: node --test two.test.js",
    "      - name: block",
    "        run: |",
    "          npx tsx --test \\",
    "            three.test.ts",
    "          # npx tsx --test shell-comment.test.ts",
    "      # - run: npx tsx --test commented.test.ts",
    "      - name: chained",
    "        run: npm run unit && npm run typecheck",
    "      - name: step if after run",
    "        run: npx tsx --test step-if.test.ts",
    "        if: ${{ false }}",
    "      - name: continue expression",
    "        continue-on-error: ${{ true }}",
    "        run: npx tsx --test continue-expr.test.ts",
    "      - name: working dir",
    "        working-directory: sub",
    "        run: npx tsx --test sub.test.ts",
    "      - name: shell",
    "        shell: bash {0}",
    "        run: npx tsx --test shell.test.ts",
    "      - run: npx tsx --test swallowed.test.ts || true",
    "      - run: echo skipped # npx tsx --test echo.test.ts",
    "      - run: npx tsx --test --test-name-pattern=NEVER filtered.test.ts",
    "      - name: folded",
    "        run: >",
    "          npx tsx --test folded.test.ts",
    "      - name: set",
    "        run: |",
    "          set +e",
    "          npx tsx --test set.test.ts",
    "  b:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: npx tsx --test job-if-later.test.ts",
    "    if: ${{ false }}",
    "  c:",
    "    needs: b",
    "    steps:",
    "      - run: npx tsx --test needs.test.ts",
    "  d:",
    "    continue-on-error: ${{ matrix.experimental }}",
    "    strategy:",
    "      matrix:",
    "        experimental: [true]",
    "    steps:",
    "      - run: npx tsx --test matrix.test.ts",
  ].join("\n");
  const scripts = { unit: "tsx --test unit.test.ts", typecheck: "tsc --noEmit" };
  const { counted } = classifySteps(readWorkflow(yaml), scripts);
  assert.deepEqual(
    counted.flatMap((s) => s.patterns).sort(),
    ["one.test.ts", "three.test.ts", "two.test.js", "unit.test.ts"]
  );
});

test("on: に paths / paths-ignore があれば見つける", () => {
  const yaml = ["on:", "  pull_request:", "    paths-ignore:", "      - '**.md'", "jobs:", "  a:", "    steps: []"].join("\n");
  assert.equal(readWorkflow(yaml).pathFilters.length, 1);
});

test("npm run は入れ子も同じ規則で読む", () => {
  const scripts = {
    outer: "npm run inner && echo ok",
    inner: "tsx --test inner.test.ts",
    swallow: "tsx --test swallow.test.ts || true",
  };
  assert.deepEqual(testPatterns("npm run outer", scripts), ["inner.test.ts"]);
  assert.equal(typeof testPatterns("npm run swallow", scripts), "string");
  assert.equal(typeof testPatterns("npm run missing", scripts), "string");
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
