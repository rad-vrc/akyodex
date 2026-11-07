import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// next.config.ts は読み込んだ時点の環境変数で設定を作る。CI の単体テストの段には DSN がなく、
// そのままでは空文字どうしを比べるだけで、DSN を渡さなくなっても通ってしまう。
// 読み込む前にダミーの DSN を入れる（node --test はファイルごとに別のプロセスで走るので、
// ほかのテストには漏れない）。静的な import は先に評価されるので、動的に読み込む
const TEST_SENTRY_DSN = "https://public@example.invalid/1";
process.env.NEXT_PUBLIC_SENTRY_DSN = TEST_SENTRY_DSN;
// 本番・ステージングの workflow のビルドと同じく、ブラウザー用のソースマップを作る設定にする
process.env.AKYODEX_BROWSER_SOURCEMAPS = "1";
const loadNextConfig = async () => (await import("./next.config")).default;

test("next image localPatterns allow both avatar and world image proxy routes", async () => {
  const nextConfig = await loadNextConfig();
  const localPatterns = nextConfig.images?.localPatterns ?? [];
  const pathnames = localPatterns.map((pattern) => pattern.pathname);

  assert.ok(pathnames.includes("/api/avatar-image"));
  assert.ok(pathnames.includes("/api/vrc-world-image"));
  for (const pattern of localPatterns) {
    assert.equal(pattern.search, undefined);
  }
});

test("Sentry public DSN is available to client and server bundles", async () => {
  const nextConfig = await loadNextConfig();
  assert.equal(nextConfig.env?.NEXT_PUBLIC_SENTRY_DSN, TEST_SENTRY_DSN);
});

test("AKYODEX_BROWSER_SOURCEMAPS=1 のときはブラウザー用のソースマップを作る", async () => {
  // Sentry に上げるのは scripts/sentry-browser-sourcemaps.js。作らないと警告だけで上がらない（本番）ので、設定の退行をここで捕まえる
  const nextConfig = await loadNextConfig();
  assert.equal(nextConfig.productionBrowserSourceMaps, true);
});

test("AKYODEX_BROWSER_SOURCEMAPS が 1 でなければソースマップを作らない（CI のビルド検証・Lighthouse など）", () => {
  // next.config.ts は読み込んだ時点の環境変数で決まるので、別のプロセスで読み込む
  for (const value of [undefined, "0", "true"]) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.AKYODEX_BROWSER_SOURCEMAPS;
    if (value !== undefined) env.AKYODEX_BROWSER_SOURCEMAPS = value;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        // ESM の入口から CJS 扱いの .ts を読むと default が二重になる（package.json に "type" がない）
        'import("./next.config.ts").then((m) => { const c = m.default.default ?? m.default; process.stdout.write(String(c.productionBrowserSourceMaps)); })',
      ],
      { cwd: path.dirname(fileURLToPath(import.meta.url)), env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "false", `AKYODEX_BROWSER_SOURCEMAPS=${value}`);
  }
});
