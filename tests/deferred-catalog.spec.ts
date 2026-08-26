import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

interface CatalogFixture {
  data: Array<Record<string, unknown>>;
}

const catalog = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "akyo-data-ja.json"), "utf8"),
) as CatalogFixture;

function waitForApiRoute(page: Page): Promise<Route> {
  return new Promise((resolve) => {
    void page.route("**/api/akyo-data?lang=ja", async (route) => {
      resolve(route);
    });
  });
}

test.describe("Deferred full catalog loading", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "AKYO_LANG",
        value: "ja",
        url: "http://localhost:3000",
      },
    ]);
  });

  test("keeps 12 initial cards interactive while filters wait for the full catalog", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1350, height: 940 });
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;

    await expect(page.locator("article.akyo-card")).toHaveCount(12);
    await expect(page.locator("input.search-input")).toBeEnabled();
    const filterFieldset = page.locator("#zukan-filter-panel > fieldset");
    const categorySearch = filterFieldset.locator('input[type="text"]').first();
    await expect(filterFieldset).toHaveAttribute("disabled", "");
    await expect(categorySearch).toBeDisabled();
    await expect(page.getByText(/表示データを読み込み中/)).toBeVisible();
    await expect(page.getByRole("button", { name: "カード表示" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "リスト表示" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "アバターのみ表示" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "ワールドのみ表示" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "BOOTH商品のみ表示" })).toBeDisabled();
    const headerHeightWhileLoading = await page
      .locator("header")
      .evaluate((header) => header.getBoundingClientRect().height);

    const firstCard = page.locator("article.akyo-card").first();
    const favoriteButton = firstCard.locator(".favorite-btn");
    await expect(favoriteButton).toBeEnabled();
    await favoriteButton.click();
    await expect(favoriteButton).toHaveAccessibleName(/お気に入り解除/);

    await firstCard.locator(".detail-button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "リスト表示" }).click();
    await expect(page.locator(".list-view-table")).toBeVisible();

    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(filterFieldset).not.toHaveAttribute("disabled", "");
    await expect(categorySearch).toBeEnabled();
    expect(
      await page
        .locator("header")
        .evaluate((header) => header.getBoundingClientRect().height),
    ).toBe(headerHeightWhileLoading);
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

  test("starts the full catalog request before the window load event", async ({
    page,
  }) => {
    let releaseLogo = () => {};
    const logoGate = new Promise<void>((resolve) => {
      releaseLogo = resolve;
    });
    await page.route("**/images/logo-*.webp", async (route) => {
      await logoGate;
      await route.continue();
    });

    const apiRequest = page
      .waitForRequest("**/api/akyo-data?lang=ja")
      .then(() => true);
    await page.goto("/zukan", { waitUntil: "domcontentloaded" });
    const requestedBeforeLoad = await Promise.race([
      apiRequest,
      page.waitForTimeout(1_500).then(() => false),
    ]);
    releaseLogo();

    expect(requestedBeforeLoad).toBe(true);
  });

  test("uses the lightweight preview data while the complete catalog is loading", async ({
    page,
  }) => {
    const apiRoutePromise = waitForApiRoute(page);
    await page.goto("/zukan");
    const apiRoute = await apiRoutePromise;
    const searchInput = page.locator("input.search-input");

    await expect(searchInput).toBeEnabled();
    await searchInput.fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(
      page.getByText("スーパーワープAkyo", { exact: true }),
    ).toBeVisible();

    await apiRoute.fulfill({ json: { data: catalog.data } });
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
    await expect(
      page.getByText("スーパーワープAkyo", { exact: true }),
    ).toBeVisible();
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

  test("keeps valid rows searchable when a catalog row is malformed", async ({
    page,
  }) => {
    await page.route("**/api/akyo-data?lang=ja", async (route) => {
      await route.fulfill({
        json: {
          data: [...catalog.data, { id: "", avatarName: "invalid" }],
        },
      });
    });

    await page.goto("/zukan");

    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.getByText(/1件のデータを読み込めませんでした/)).toBeVisible();
    await page.locator("input.search-input").fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);
  });

  test("uses R2 without showing an error when the API fails", async ({ page }) => {
    await page.route("**/api/akyo-data?lang=ja", async (route) => {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await page.route("**/data/akyo-data-ja.json", async (route) => {
      await route.fulfill({ json: { data: catalog.data } });
    });

    await page.goto("/zukan");

    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.getByRole("button", { name: /再試行/ })).toHaveCount(0);
  });

  test("keeps initial cards and retries after both sources fail", async ({ page }) => {
    let apiAttempts = 0;
    await page.route("**/api/akyo-data?lang=ja", async (route) => {
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

    await page.goto("/zukan");

    await expect(page.locator("article.akyo-card")).toHaveCount(12);
    const searchInput = page.locator("input.search-input");
    await expect(searchInput).toBeEnabled();
    const retryButton = page.getByRole("button", { name: /再試行/ });
    await expect(retryButton).toBeVisible();

    await searchInput.fill("スーパーワープAkyo");
    await expect(page.locator("article.akyo-card")).toHaveCount(1);

    await retryButton.click();

    await expect(page.locator("input.search-input")).toBeEnabled();
    expect(apiAttempts).toBe(2);
  });

  test("requests and renders the complete dataset for all supported languages", async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixtures = {
      ja: JSON.parse(
        readFileSync(path.join(process.cwd(), "data", "akyo-data-ja.json"), "utf8"),
      ) as CatalogFixture,
      en: JSON.parse(
        readFileSync(path.join(process.cwd(), "data", "akyo-data-en.json"), "utf8"),
      ) as CatalogFixture,
      ko: JSON.parse(
        readFileSync(path.join(process.cwd(), "data", "akyo-data-ko.json"), "utf8"),
      ) as CatalogFixture,
    };
    const requestedLanguages: string[] = [];
    await page.route("**/api/akyo-data?lang=*", async (route) => {
      const lang = new URL(route.request().url()).searchParams.get("lang") ?? "ja";
      requestedLanguages.push(lang);
      await route.fulfill({
        json: { data: fixtures[lang as keyof typeof fixtures].data },
      });
    });

    for (const lang of ["ja", "en", "ko"] as const) {
      await context.clearCookies();
      await context.addCookies([
        {
          name: "AKYO_LANG",
          value: lang,
          url: "http://localhost:3000",
        },
      ]);
      await page.goto("/zukan");
      await expect(page.locator("input.search-input")).toBeEnabled();
      await expect(page.locator("#zukan-filter-panel > fieldset")).toBeEnabled();
      await expect
        .poll(() => requestedLanguages.includes(lang))
        .toBe(true);
      expect(
        await page.locator("header").last().evaluate(
          (header) => header.scrollWidth <= header.clientWidth,
        ),
      ).toBe(true);
    }

    expect(requestedLanguages).toEqual(["ja", "en", "ko"]);
  });
});
