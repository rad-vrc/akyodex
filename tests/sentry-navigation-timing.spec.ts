import { expect, test } from "@playwright/test";

/**
 * Sentry の遷移計測（PR-C の回帰テスト）。
 *
 * Next の App Router は RSC 応答を待ってから History を更新する遷移があるため、History 監視だけだと
 * navigation span が応答後に始まり、利用者の待ち時間が抜ける。onRouterTransitionStart（遷移開始）で
 * span を開始していれば、RSC 応答を 2 秒遅らせたときの所要時間は 2 秒以上になる。
 *
 * 前提: ブラウザ側の Sentry が初期化されていること（NEXT_PUBLIC_SENTRY_DSN が必要。ダミーで可）。
 *   NEXT_PUBLIC_SENTRY_DSN=https://k@o1.ingest.sentry.io/1 npx playwright test tests/sentry-navigation-timing.spec.ts
 * 初期化されていない場合は skip する。送信先はこのテスト内で受け止めるので、外部には出ない。
 */

const RSC_DELAY_MS = 2000;

test.use({ serviceWorkers: "block" });

async function sentryClientState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const carrier = (window as unknown as { __SENTRY__?: Record<string, unknown> }).__SENTRY__;
    if (!carrier) return { initialized: false, tracing: false };
    for (const key of Object.keys(carrier)) {
      const entry = carrier[key] as { defaultCurrentScope?: { getClient?: () => { getIntegrationByName?: (n: string) => unknown } | undefined } };
      const client = entry?.defaultCurrentScope?.getClient?.();
      if (client) {
        return { initialized: true, tracing: Boolean(client.getIntegrationByName?.("BrowserTracing")) };
      }
    }
    return { initialized: false, tracing: false };
  });
}

test("Link による /zukan → /admin の遷移は、RSC 応答待ちを含む navigation span になる", async ({ page }) => {
  // 本番ビルドは tracesSampleRate 0.1（開発は 1.0）。テストを決定的にするため、
  // クライアント初期化直後にサンプリングを 100% にする（tracing の読み込みより前に効く）
  await page.addInitScript(() => {
    const timer = setInterval(() => {
      const carrier = (window as unknown as { __SENTRY__?: Record<string, unknown> }).__SENTRY__;
      if (!carrier) return;
      for (const key of Object.keys(carrier)) {
        const entry = carrier[key] as { defaultCurrentScope?: { getClient?: () => { getOptions: () => { tracesSampleRate?: number } } | undefined } };
        const client = entry?.defaultCurrentScope?.getClient?.();
        if (client) {
          client.getOptions().tracesSampleRate = 1;
          clearInterval(timer);
          return;
        }
      }
    }, 5);
  });

  const envelopes: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/envelope/")) {
      envelopes.push(request.postData() ?? "");
      await route.fulfill({ status: 200, body: "{}", headers: { "content-type": "application/json" } });
      return;
    }
    // /admin の RSC 応答だけ遅らせる（遷移先データの待ち時間を再現）
    if (request.headers()["rsc"] === "1" && new URL(url).pathname === "/admin") {
      await new Promise((resolve) => setTimeout(resolve, RSC_DELAY_MS));
    }
    await route.continue();
  });

  await page.goto("/zukan", { waitUntil: "load" });
  const state = await sentryClientState(page);
  test.skip(!state.initialized, "NEXT_PUBLIC_SENTRY_DSN が無く Sentry が初期化されていない");

  // 遅延読み込みの tracing が入るまで待つ（load 後の idle、上限 4 秒）
  await expect.poll(async () => (await sentryClientState(page)).tracing, { timeout: 15_000 }).toBe(true);

  const startedAt = Date.now();
  await page.locator('a[href="/admin"]').first().click();
  await page.waitForURL(/\/admin(\?|$)/, { timeout: 30_000 });
  const arrivedMs = Date.now() - startedAt;
  expect(arrivedMs).toBeGreaterThanOrEqual(RSC_DELAY_MS);

  // idle span の終了と送信を待つ
  await expect
    .poll(
      () => envelopes.filter((body) => body.includes('"type":"transaction"') && body.includes('"op":"navigation"')).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1);

  const navigations = envelopes
    .filter((body) => body.includes('"type":"transaction"') && body.includes('"op":"navigation"'))
    .map((body) => {
      const item = body.split("\n").find((line) => line.includes('"type":"transaction"') && line.includes('"contexts"'))
        ?? body.split("\n").at(-1)
        ?? "";
      const parsed = JSON.parse(item) as { transaction?: string; start_timestamp?: number; timestamp?: number };
      return {
        name: parsed.transaction,
        durationMs: Math.round(((parsed.timestamp ?? 0) - (parsed.start_timestamp ?? 0)) * 1000),
      };
    });

  // /admin への navigation が 1 件だけ（History 監視との二重作成が無い）
  const admin = navigations.filter((n) => n.name === "/admin");
  expect(admin, JSON.stringify(navigations)).toHaveLength(1);
  // 遷移開始から RSC 応答（2 秒遅延）までが含まれている
  expect(admin[0].durationMs).toBeGreaterThanOrEqual(RSC_DELAY_MS - 100);
});
