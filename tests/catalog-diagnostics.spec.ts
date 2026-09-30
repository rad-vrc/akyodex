import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Event } from "@sentry/react";

type Language = "ja" | "en" | "ko";
type Source = "api" | "r2" | "snapshot";
interface CatalogFixture {
  data: Array<Record<string, unknown>>;
}

function readCatalog(language: Language): CatalogFixture {
  return JSON.parse(readFileSync(`data/akyo-data-${language}.json`, "utf8")) as CatalogFixture;
}

async function preparePage(page: Page, baseURL: string | undefined, language: Language) {
  // Run with playwright.catalog-diagnostics.config.ts: its DSN points only at localhost.
  test.skip(baseURL !== "http://localhost:3517", "requires the dedicated local-only telemetry configuration");
  const events: Event[] = [];
  await page.setViewportSize({ width: 1350, height: 940 });
  await page.context().addCookies([{ name: "AKYO_LANG", value: language, url: baseURL! }]);
  await page.addInitScript(() => {
    // Sentry obtains native fetch from a temporary iframe. Do not bind its
    // transport to that iframe, which the SDK removes immediately afterward.
    if (window !== window.top) return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const pathname = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      const source = /^\/api\/catalog\/(ja|en|ko)$/.test(pathname) ? "api"
        : /^\/data\/akyo-data-(ja|en|ko)\.json$/.test(pathname) ? "r2" : null;
      if (source) {
        performance.mark(`catalog-test-${source}-start`);
        // Observe the real signal without replacing fetch: a preload can keep the
        // network request alive even after the loader's fetch has been aborted.
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        signal?.addEventListener("abort", () => performance.mark(`catalog-test-${source}-aborted`), { once: true });
      }
      return nativeFetch(input, init);
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    // Catalog routes registered below supply all R2 responses locally, too.
    if (url.origin !== baseURL) {
      await route.abort();
    } else if (/^\/api\/\d+\/envelope\/?$/.test(url.pathname)) {
      const lines = (route.request().postData() ?? "").split("\n");
      for (let i = 1; i + 1 < lines.length; i += 2) {
        if (JSON.parse(lines[i]).type === "event") events.push(JSON.parse(lines[i + 1]));
      }
      await route.fulfill({ json: {} });
    } else {
      await route.continue();
    }
  });
  return events;
}

async function holdCatalogSources(page: Page, language: Language) {
  const routes: Record<Source, Route[]> = { api: [], r2: [], snapshot: [] };
  const patterns: Record<Source, string> = {
    api: "**/api/catalog/*",
    r2: "**/data/akyo-data-*.json",
    snapshot: "**/catalog/catalog-v1-*.json",
  };
  const paths: Record<Source, string> = {
    api: `/api/catalog/${language}`,
    r2: `/data/akyo-data-${language}.json`,
    snapshot: `/catalog/catalog-v1-${language}.json`,
  };
  for (const source of ["api", "r2", "snapshot"] as const) {
    await page.route(patterns[source], (route) => {
      expect(new URL(route.request().url()).pathname).toBe(paths[source]);
      // Leaving the route unresolved holds it until the test supplies a response.
      routes[source].push(route);
    });
  }
  return {
    routes,
    counts: () => ({ api: routes.api.length, r2: routes.r2.length, snapshot: routes.snapshot.length }),
  };
}

async function expectInitialCatalog(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByName("catalog-fetch-start").length > 0);
  await expect(page.locator("article.akyo-card")).toHaveCount(12);
  await expect(page.locator("input.search-input")).toBeDisabled();
  await expect(page.locator("#zukan-filter-panel > fieldset")).toHaveAttribute("disabled", "");
}

async function expectCompleteCatalog(page: Page, count: number) {
  await expect(page.locator("input.search-input")).toBeEnabled();
  await expect(page.locator("#zukan-filter-panel > fieldset")).not.toHaveAttribute("disabled", "");
  const countPattern = new RegExp(`^\\D*${count}(?:\\D|$)`);
  // The displayed count, unlike the server-provided total, cannot be ready from initial12 alone.
  await expect(page.locator("header dl > div").nth(0).locator("dd")).toHaveText(countPattern);
  await expect(page.locator("header dl > div").nth(1).locator("dd")).toHaveText(countPattern);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("catalog-ready").length)).toBe(1);
}

async function expectSourceAborted(page: Page, source: "api" | "r2") {
  await expect.poll(() => page.evaluate(
    (name) => performance.getEntriesByName(name).length,
    `catalog-test-${source}-aborted`,
  )).toBe(1);
}

test("the actual catalog view reports a slow API success with R2 explicitly held", async ({ page, baseURL }) => {
  const events = await preparePage(page, baseURL, "ja");
  const catalog = readCatalog("ja");
  const { routes, counts } = await holdCatalogSources(page, "ja");

  await page.goto("/zukan", { waitUntil: "domcontentloaded" });
  await expectInitialCatalog(page);
  // Cross the diagnostic threshold while both live responses remain held.
  await page.waitForFunction(() => {
    const start = performance.getEntriesByName("catalog-fetch-start")[0];
    return start && performance.now() - start.startTime >= 3200;
  });
  await expect.poll(counts).toEqual({ api: 1, r2: 1, snapshot: 0 });
  await expect(page.locator("input.search-input")).toBeDisabled();
  await routes.api[0].fulfill({
    contentType: "application/json",
    headers: { "Server-Timing": 'catalog_kv;dur=3100, catalog_handler;dur=3120, catalog_worker;dur=3150, catalog_source;desc="kv-payload", catalog_generated;desc="1000"' },
    body: JSON.stringify(catalog),
  });
  await expectCompleteCatalog(page, catalog.data.length);

  const slowEvents = () => events.filter((event) => event.fingerprint?.includes("catalog-slow-load"));
  await expect.poll(() => slowEvents().length).toBe(1);
  const event = slowEvents()[0];
  expect(event.tags?.catalog_source).toBe("api");
  expect(event.extra?.durationMs).toBeGreaterThanOrEqual(3000);
  const requests = event.extra?.requests as Record<string, unknown>[];
  // The loser may finish recording before the winner; do not rely on request array order.
  const apiTiming = requests.find((request) => request.source === "api");
  expect(apiTiming).toMatchObject({ outcome: "success", catalog_kv: 3100, serverSource: "kv-payload" });
  expect(apiTiming?.headersWaitMs).toBeGreaterThanOrEqual(3000);
  expect(requests.find((request) => request.source === "r2")).toMatchObject({
    outcome: "aborted", abortReason: "superseded", trigger: "delayed-hedge",
  });

  await expectSourceAborted(page, "r2");
  await routes.r2[0].fulfill({ json: { data: catalog.data.slice(0, 13) } });
  await expectCompleteCatalog(page, catalog.data.length);
  await page.locator("input.search-input").fill("Akyo");
  expect(slowEvents()).toHaveLength(1);
  expect(counts()).toEqual({ api: 1, r2: 1, snapshot: 0 });
});

for (const language of ["ja", "en", "ko"] as const) {
  test(`${language}: R2 enables the actual catalog while API is held and a late API cannot overwrite it`, async ({ page, baseURL }) => {
    await preparePage(page, baseURL, language);
    const catalog = readCatalog(language);
    const name = `R2WinnerOnly${language}`;
    const category = `R2CategoryOnly${language}`;
    const r2Data = catalog.data.map((item, index) => index === 12
      ? { ...item, avatarName: name, nickname: name, category, parsedCategory: [category] }
      : item);
    const { routes, counts } = await holdCatalogSources(page, language);

    await page.goto("/zukan", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expectInitialCatalog(page);
    // This must happen before the held API times out; the old serial loader cannot pass.
    await expect.poll(counts, { timeout: 5000 }).toEqual({ api: 1, r2: 1, snapshot: 0 });
    const fallbackDelayMs = await page.evaluate(() => Math.round(
      performance.getEntriesByName("catalog-test-r2-start")[0].startTime
      - performance.getEntriesByName("catalog-fetch-start")[0].startTime,
    ));
    expect(fallbackDelayMs).toBeGreaterThanOrEqual(2000);
    await routes.r2[0].fulfill({ json: { data: r2Data } });
    await expectCompleteCatalog(page, r2Data.length);
    await expectSourceAborted(page, "api");

    const categorySearch = page.locator("#zukan-filter-panel input[type=text]").first();
    await expect(categorySearch).toBeEnabled();
    await categorySearch.fill(category);
    const categoryOption = page.getByRole("option", { name: category, exact: true });
    await expect(categoryOption).toBeEnabled();
    await categoryOption.click();
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(page.locator("article.akyo-card").first()).toContainText(name);
    await page.getByRole("option", { name: new RegExp(category) }).click();
    await categorySearch.fill("");

    const search = page.locator("input.search-input");
    await search.fill(name);
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(page.locator("article.akyo-card").first()).toContainText(name);
    expect(counts()).toEqual({ api: 1, r2: 1, snapshot: 0 });

    // A smaller, valid API payload would erase both the R2-only entry and the full count.
    await routes.api[0].fulfill({ json: { data: catalog.data.slice(0, 13) } });
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(page.locator("article.akyo-card").first()).toContainText(name);
    await search.fill("");
    await expectCompleteCatalog(page, r2Data.length);
    expect(counts()).toEqual({ api: 1, r2: 1, snapshot: 0 });
  });
}

test("a fast valid API response never starts R2 or the snapshot", async ({ page, baseURL }) => {
  await preparePage(page, baseURL, "ja");
  const catalog = readCatalog("ja");
  const { routes, counts } = await holdCatalogSources(page, "ja");
  await page.unroute("**/api/catalog/*");
  await page.route("**/api/catalog/*", async (route) => {
    expect(new URL(route.request().url()).pathname).toBe("/api/catalog/ja");
    routes.api.push(route);
    await route.fulfill({ json: catalog });
  });

  await page.goto("/zukan", { waitUntil: "domcontentloaded" });
  await expectCompleteCatalog(page, catalog.data.length);
  // Observe beyond the delayed-fallback window to catch an uncleared timer.
  await page.waitForFunction(() => {
    const start = performance.getEntriesByName("catalog-fetch-start")[0];
    return start && performance.now() - start.startTime >= 2500;
  });
  expect(counts()).toEqual({ api: 1, r2: 0, snapshot: 0 });
});

for (const firstFailure of ["api", "r2"] as const) {
  test(`snapshot waits for both live failures when ${firstFailure} fails first`, async ({ page, baseURL }) => {
    await preparePage(page, baseURL, "ja");
    const { routes, counts } = await holdCatalogSources(page, "ja");
    await page.goto("/zukan", { waitUntil: "domcontentloaded" });
    await expectInitialCatalog(page);
    await expect.poll(counts, { timeout: 5000 }).toEqual({ api: 1, r2: 1, snapshot: 0 });

    const firstRoute = routes[firstFailure][0];
    await firstRoute.fulfill({ status: 503, json: { error: "unavailable" } });
    await expectSourceAborted(page, firstFailure);
    await expectInitialCatalog(page);
    expect(counts()).toEqual({ api: 1, r2: 1, snapshot: 0 });

    const secondSource = firstFailure === "api" ? "r2" : "api";
    await routes[secondSource][0].fulfill({ status: 503, json: { error: "unavailable" } });
    await expect.poll(counts).toEqual({ api: 1, r2: 1, snapshot: 1 });
    await expectInitialCatalog(page);
    const snapshot = JSON.parse(readFileSync("public/catalog/catalog-v1-ja.json", "utf8")) as CatalogFixture;
    await routes.snapshot[0].fulfill({ json: snapshot });
    await expectCompleteCatalog(page, snapshot.data.length);
    expect(counts()).toEqual({ api: 1, r2: 1, snapshot: 1 });
  });
}
