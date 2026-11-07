import assert from "node:assert/strict";
import test from "node:test";

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
