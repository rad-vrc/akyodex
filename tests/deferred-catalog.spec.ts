import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

interface CatalogFixture {
  data: Array<Record<string, unknown>>;
}

function readCatalog(language: "ja" | "en" | "ko"): CatalogFixture {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "data", `akyo-data-${language}.json`),
      "utf8",
    ),
  ) as CatalogFixture;
}

const catalog = readCatalog("ja");

function waitForApiRoute(page: Page, language = "ja"): Promise<Route> {
  return new Promise((resolve) => {
    void page.route(`**/api/catalog/${language}`, async (route) => {
      resolve(route);
    });
  });
}

test.describe("Complete catalog loading", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "AKYO_LANG",
        value: "ja",
        url: "http://localhost:3000",
      },
    ]);
  });

  test("keeps 12 complete initial cards interactive while catalog controls wait", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1350, height: 940 });
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;

    await expect(page.locator("article.akyo-card")).toHaveCount(12);
    await expect(page.locator("input.search-input")).toBeDisabled();
    const filterFieldset = page.locator("#zukan-filter-panel > fieldset");
    await expect(filterFieldset).toHaveAttribute("disabled", "");
    await expect(page.getByText(/表示データを読み込み中/)).toBeVisible();
    await expect(page.getByRole("button", { name: "カード表示" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "リスト表示" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "アバターのみ表示" })).toBeDisabled();

    const firstCard = page.locator("article.akyo-card").first();
    const favoriteButton = firstCard.locator(".favorite-btn");
    await favoriteButton.click();
    await expect(favoriteButton).toHaveAccessibleName(/お気に入り解除/);

    await firstCard.locator(".detail-button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("すべてのはじまり", { exact: true })).toBeVisible();
    await expect(dialog.getByText("VRChat アバターURL", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "VRChatで見る" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "リスト表示" }).click();
    await expect(page.locator(".list-view-table")).toBeVisible();

    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.locator("#catalog-status-announcement")).toContainText(
      "図鑑の読み込みが完了しました",
    );
    await expect(page.getByLabel("カテゴリ名を検索...")).toBeVisible();
    await expect(filterFieldset).not.toHaveAttribute("disabled", "");
    await expect(page.locator(".list-view-table")).toBeVisible();
    await page.getByRole("button", { name: "カード表示" }).click();
    await expect(
      page
        .locator("article.akyo-card")
        .filter({ hasText: "オリジンAkyo" })
        .locator(".favorite-btn"),
    ).toHaveAccessibleName(/お気に入り解除/);

    await page.locator("input.search-input").fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(page.getByText("スーパーワープAkyo", { exact: true })).toBeVisible();
  });

  test("loads avatar cards through the fixed-width transformation API", async ({
    page,
  }) => {
    let avatarImageRequestCount = 0;
    await page.route("**/api/avatar-image?id=0001&w=768", async (route) => {
      avatarImageRequestCount += 1;
      await route.fulfill({
        body: readFileSync(
          path.join(process.cwd(), "public", "images", "profileIcon.webp"),
        ),
        contentType: "image/webp",
        status: 200,
      });
    });

    await page.goto("/zukan");

    const firstCardImage = page.locator("article.akyo-card img").first();
    await expect(firstCardImage).toHaveAttribute(
      "src",
      /\/api\/avatar-image\?id=0001&w=768$/,
    );
    await expect.poll(() => avatarImageRequestCount).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => url.includes("/_next/image")),
        ),
      )
      .toEqual([]);
  });

  test("falls back to the direct R2 image when the transformation API fails", async ({
    page,
  }) => {
    let transformationRequestCount = 0;
    let directR2RequestCount = 0;
    const fallbackImage = readFileSync(
      path.join(process.cwd(), "public", "images", "profileIcon.webp"),
    );

    await page.route("**/api/avatar-image?id=0001&w=768", async (route) => {
      transformationRequestCount += 1;
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        json: {
          success: false,
          error: "Avatar image upstream request failed",
        },
      });
    });
    await page.route("**/0001.webp", async (route) => {
      directR2RequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: fallbackImage,
      });
    });

    await page.goto("/zukan");

    const firstCardImage = page.locator("article.akyo-card img").first();
    await expect(firstCardImage).toHaveAttribute(
      "src",
      /\/0001\.webp$/,
    );
    expect(transformationRequestCount).toBeGreaterThan(0);
    expect(directR2RequestCount).toBeGreaterThan(0);
  });

  test("preloads the exact complete catalog URL before the window load event", async ({
    page,
  }) => {
    let catalogRequestCount = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/catalog/ja") {
        catalogRequestCount += 1;
      }
    });
    let releaseLogo = () => {};
    const logoGate = new Promise<void>((resolve) => {
      releaseLogo = resolve;
    });
    await page.route("**/images/logo-*.webp", async (route) => {
      await logoGate;
      await route.continue();
    });

    const catalogRequest = page.waitForRequest("**/api/catalog/ja").then(() => true);
    await page.goto("/zukan", { waitUntil: "domcontentloaded" });
    const requestedBeforeLoad = await Promise.race([
      catalogRequest,
      page.waitForTimeout(1_500).then(() => false),
    ]);
    releaseLogo();

    expect(requestedBeforeLoad).toBe(true);
    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect.poll(() => catalogRequestCount).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("mark")
            .map((entry) => entry.name)
            .filter((name) => name.startsWith("catalog-")),
        ),
      )
      .toEqual([
        "catalog-fetch-start",
        "catalog-normalize-start",
        "catalog-normalize-end",
        "catalog-response",
        "catalog-search-index-start",
        "catalog-search-index-end",
        "catalog-state-apply-start",
        "catalog-state-apply-end",
        "catalog-ready",
      ]);
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("measure")
            .map((entry) => entry.name)
            .filter((name) => name.startsWith("catalog-")),
        ),
      )
      .toEqual([
        "catalog-normalize",
        "catalog-search-index",
        "catalog-state-apply",
      ]);
  });

  test("reserves the desktop filter height while the deferred controls load", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1350, height: 940 });
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;
    const filterFieldset = page.locator("#zukan-filter-panel > fieldset");
    const viewControls = page.getByRole("button", { name: "カード表示" });

    await expect(filterFieldset).toHaveAttribute("aria-busy", "true");
    await expect(filterFieldset).toBeVisible();
    const pendingFilterBox = await filterFieldset.boundingBox();
    const pendingViewControlsBox = await viewControls.boundingBox();

    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(page.getByLabel("カテゴリ名を検索...")).toBeVisible();
    const loadedFilterBox = await filterFieldset.boundingBox();
    const loadedViewControlsBox = await viewControls.boundingBox();

    expect(pendingFilterBox?.height).toBe(loadedFilterBox?.height);
    expect(pendingViewControlsBox?.y).toBe(loadedViewControlsBox?.y);
  });

  test("opens a complete legacy shared entry before the full catalog arrives", async ({
    page,
  }) => {
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan?id=Avatar0013");
    const apiRoute = await apiRoutePromise;

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("スーパーワープAkyo", { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog.getByText("VRChat アバターURL", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "VRChatで見る" })).toBeVisible();
    await expect(page.locator("input.search-input")).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(page.locator("#main-content")).toBeFocused();

    await apiRoute.fulfill({ json: { data: catalog.data } });
  });

  test("does not expose entries after the first 12 until complete data arrives", async ({
    page,
  }) => {
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;

    const searchInput = page.locator("input.search-input");
    await expect(searchInput).toBeDisabled();
    await expect(page.getByText("スーパーワープAkyo", { exact: true })).toHaveCount(0);

    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(searchInput).toBeEnabled();
    await searchInput.fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(page.getByText("スーパーワープAkyo", { exact: true })).toBeVisible();
  });

  test("shows favorite loading state until the complete catalog is available", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "akyoFavorites",
        JSON.stringify(["0500", "0600", "0700"]),
      );
    });
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;
    const favoriteStat = page
      .locator("header dl > div")
      .filter({ hasText: "お気に入り" });

    await expect(favoriteStat).toContainText("…");
    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(favoriteStat).toContainText("3");
  });

  test("keeps valid rows searchable when one complete catalog row is malformed", async ({
    page,
  }) => {
    await page.route("**/api/catalog/ja", async (route) => {
      await route.fulfill({
        json: {
          data: [...catalog.data, { id: "", avatarName: "invalid" }],
        },
      });
    });

    await page.goto("/zukan");

    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(
      page.getByText(/1件のデータを読み込めませんでした/).last(),
    ).toBeVisible();
    await page.locator("input.search-input").fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
  });

  test("uses R2 without showing an error when the catalog API fails", async ({
    page,
  }) => {
    await page.route("**/api/catalog/ja", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await page.route("**/data/akyo-data-ja.json", async (route) => {
      await route.fulfill({ json: { data: catalog.data } });
    });

    await page.goto("/zukan");

    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.getByRole("button", { name: /再試行/ })).toHaveCount(0);
  });

  test("uses the bundled snapshot after API and R2 both fail", async ({ page }) => {
    await page.route("**/api/catalog/ja", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await page.route("**/data/akyo-data-ja.json", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });

    await page.goto("/zukan");

    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.getByRole("button", { name: /再試行/ })).toHaveCount(0);
  });

  test("keeps complete initial cards and retries after all sources fail", async ({
    page,
  }) => {
    let apiAttempts = 0;
    await page.route("**/api/catalog/ja", async (route) => {
      apiAttempts += 1;
      if (apiAttempts === 1) {
        await route.fulfill({ status: 503, json: { error: "unavailable" } });
        return;
      }
      await route.fulfill({ json: { data: catalog.data } });
    });
    await page.route("**/data/akyo-data-ja.json", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await page.route("**/catalog/catalog-v1-ja.json", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });

    await page.goto("/zukan");

    await expect(page.locator("article.akyo-card")).toHaveCount(12);
    const searchInput = page.locator("input.search-input");
    await expect(searchInput).toBeDisabled();
    const retryButton = page.getByRole("button", { name: /再試行/ });
    await expect(retryButton).toBeVisible();

    await page.locator("article.akyo-card").first().locator(".detail-button").click();
    await expect(
      page.getByRole("dialog").getByText("すべてのはじまり", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "VRChatで見る" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await retryButton.click();

    await expect(searchInput).toBeEnabled();
    expect(apiAttempts).toBe(2);
  });

  test("requests and renders the complete dataset for all supported languages", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixtures = {
      ja: readCatalog("ja"),
      en: readCatalog("en"),
      ko: readCatalog("ko"),
    };
    const requestedLanguages: string[] = [];
    await page.route("**/api/catalog/*", async (route) => {
      const language = new URL(route.request().url()).pathname.split("/").at(-1) ?? "ja";
      requestedLanguages.push(language);
      await route.fulfill({
        json: { data: fixtures[language as keyof typeof fixtures].data },
      });
    });

    for (const language of ["ja", "en", "ko"] as const) {
      await context.clearCookies();
      await context.addCookies([
        {
          name: "AKYO_LANG",
          value: language,
          url: "http://localhost:3000",
        },
      ]);
      await page.goto("/zukan");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator("input.search-input")).toBeEnabled();
      await expect(page.locator("#zukan-filter-panel > fieldset")).toBeEnabled();
      await expect.poll(() => requestedLanguages.includes(language)).toBe(true);
      expect(
        await page.locator("header").last().evaluate(
          (header) => header.scrollWidth <= header.clientWidth,
        ),
      ).toBe(true);
    }

    expect(requestedLanguages).toEqual(["ja", "en", "ko"]);
  });
});
