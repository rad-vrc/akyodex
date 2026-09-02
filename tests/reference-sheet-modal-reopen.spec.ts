import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createCatalogPayload } from "../src/lib/catalog-payload";
import type { AkyoData } from "../src/types/akyo";

const imageBody = readFileSync(
  path.join(process.cwd(), "public", "images", "profileIcon.webp"),
);
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "data/akyo-data-ja.json"), "utf8")) as { data: AkyoData[] };
const pageErrors = new WeakMap<Page, string[]>();

async function replaceFirstCatalogEntry(page: Page, overrides: Partial<AkyoData>): Promise<void> {
  const entries = catalog.data.map((entry) => entry.id === "0001" ? { ...entry, ...overrides } : entry);
  const payload = await createCatalogPayload("ja", entries);
  await page.route("**/api/catalog/ja", (route) => route.fulfill({ json: payload }));
}

async function openFirstAvatarDetail(page: Page): Promise<Locator> {
  const firstCard = page.locator("article.akyo-card").first();
  await expect(firstCard).toBeVisible();
  await firstCard.locator(".detail-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectImageLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const htmlImage = element as HTMLImageElement;
        return htmlImage.complete && htmlImage.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

function fulfillWebP(route: Route): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "image/webp",
    body: imageBody,
  });
}

test.describe("Pre-generated reference sheet modal", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ context, page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await context.addCookies([
      {
        name: "AKYO_LANG",
        value: "ja",
        url: "http://localhost:3000",
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page)).toEqual([]);
  });

  test("requests only the 960px derivative after the modal opens", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    await page.route("**/reference/0001-1920.webp", fulfillWebP);
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    expect(requested.filter((url) => url.includes("/reference/0001-"))).toHaveLength(0);

    const dialog = await openFirstAvatarDetail(page);
    const preview = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(preview).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expectImageLoaded(preview);

    expect(requested.filter((url) => url.endsWith("/reference/0001-960.webp"))).toHaveLength(1);
    expect(requested.filter((url) => url.endsWith("/reference/0001-1920.webp"))).toHaveLength(0);
    expect(requested.filter((url) => url.endsWith("/0001.png"))).toHaveLength(0);
    expect(requested.filter((url) => url.includes("/api/reference-image"))).toHaveLength(0);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });

  test("keeps the 960px image visible until the zoom derivative finishes", async ({ page }) => {
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    let releaseZoom: (() => void) | undefined;
    const zoomRequested = new Promise<void>((resolve) => {
      void page.route("**/reference/0001-1920.webp", async (route) => {
        resolve();
        await new Promise<void>((release) => {
          releaseZoom = release;
        });
        await fulfillWebP(route);
      });
    });

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const image = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expectImageLoaded(image);
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);

    await dialog
      .getByRole("button", { name: /画像のズーム切り替え|Toggle image zoom/i })
      .click({ position: { x: 120, y: 80 } });
    await zoomRequested;
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    const zoomImage = dialog.locator("[data-reference-zoom-image]");
    await expect(zoomImage).toHaveAttribute("src", /\/reference\/0001-1920\.webp$/);
    await expect(zoomImage).toHaveClass(/opacity-0/);

    releaseZoom?.();
    await expectImageLoaded(zoomImage);
    await expect(zoomImage).toHaveClass(/opacity-100/);
    await expect(image).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });

  test("falls back through the generated zoom image to the original PNG", async ({ page }) => {
    await page.route("**/reference/0001-960.webp", (route) =>
      route.fulfill({ status: 404, body: "missing preview" }),
    );
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const original = dialog.getByAltText("オリジンAkyo", { exact: true });

    await expect(original).toHaveAttribute("src", /\/0001\.png$/);
    await expectImageLoaded(original);
    await expect(original).not.toHaveAttribute("role", "presentation");
  });

  test("keeps a successful card fallback accessible after all reference images fail", async ({
    page,
  }) => {
    await page.route("**/reference/0001-960.webp", (route) =>
      route.fulfill({ status: 404, body: "missing preview" }),
    );
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 404, body: "missing original" }),
    );
    await page.route("**/api/avatar-image?id=0001**", fulfillWebP);

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const fallbackImage = dialog.locator('img[src*="/api/avatar-image?id=0001"]');

    await expectImageLoaded(fallbackImage);
    await expect(fallbackImage).toHaveAttribute("alt", "オリジンAkyo");
    await expect(fallbackImage).not.toHaveAttribute("role", "presentation");
    await expect(fallbackImage).not.toHaveAttribute("style", /linear-gradient/);
  });

  test("retries from the 960px derivative when reopening the same Akyo", async ({ page }) => {
    let previewRequests = 0;
    await page.route("**/reference/0001-960.webp", async (route) => {
      previewRequests += 1;
      if (previewRequests === 1) {
        await route.fulfill({ status: 502, body: "temporary failure" });
        return;
      }
      await fulfillWebP(route);
    });
    await page.route("**/reference/0001-1920.webp", (route) =>
      route.fulfill({ status: 404, body: "missing zoom" }),
    );
    await page.route("**/0001.png", fulfillWebP);

    await page.goto("/zukan");
    let dialog = await openFirstAvatarDetail(page);
    await expect(dialog.getByAltText("オリジンAkyo", { exact: true })).toHaveAttribute(
      "src",
      /\/0001\.png$/,
    );

    await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
    await expect(dialog).toBeHidden();

    dialog = await openFirstAvatarDetail(page);
    const recovered = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(recovered).toHaveAttribute("src", /\/reference\/0001-960\.webp$/);
    await expectImageLoaded(recovered);
    expect(previewRequests).toBe(2);
  });

  test("does not request 1920px on reopening after zoom, across three sessions", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    for (let run = 0; run < 3; run += 1) {
      let dialog = await openFirstAvatarDetail(page);
      await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
      await dialog.locator('[role="button"][aria-roledescription]').press("Enter");
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
      await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
      await expect(dialog).toBeHidden();
      const before = requested.length;

      dialog = await openFirstAvatarDetail(page);
      await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
      const opened = requested.slice(before).filter((url) => url.includes("/reference/"));
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatch(/\/0001-960\.webp$/);

      await dialog.locator('[role="button"][aria-roledescription]').press("Enter");
      await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
      expect(requested.slice(before).filter((url) => url.endsWith("/0001-1920.webp"))).toHaveLength(1);
      await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test("opens a different Akyo with no previous image or zoom request", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    let dialog = await openFirstAvatarDetail(page);
    await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
    await dialog.locator('[role="button"][aria-roledescription]').press("Enter");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    await dialog.getByRole("button", { name: /閉じる|Close|닫기/i }).click();
    await expect(dialog).toBeHidden();
    const before = requested.length;
    await page.locator('article[aria-labelledby="card-title-0002"] .detail-button').click();
    dialog = page.getByRole("dialog");
    await expectImageLoaded(dialog.getByAltText("チョコミントAkyo", { exact: true }));
    expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toEqual([
      expect.stringMatching(/\/0002-960\.webp$/),
    ]);
  });

  test("retains 960px after zoom failure and does not retry until another session", async ({ page }) => {
    let zoomRequests = 0;
    await page.route("**/reference/0001-960.webp", fulfillWebP);
    await page.route("**/reference/0001-1920.webp", (route) => {
      zoomRequests += 1;
      return route.fulfill({ status: 404, body: "missing zoom" });
    });
    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const image = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expectImageLoaded(image);
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    await viewer.press("Enter");
    await expect.poll(() => zoomRequests).toBe(1);
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    await viewer.press("Enter");
    await viewer.press("Enter");
    await expect(image).toHaveAttribute("src", /\/0001-960\.webp$/);
    await expectImageLoaded(image);
    expect(zoomRequests).toBe(1);
  });

  test("favorite updates do not reset the image session or zoom", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.route("**/reference/*.webp", fulfillWebP);
    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    await expectImageLoaded(dialog.getByAltText("オリジンAkyo", { exact: true }));
    const viewer = dialog.locator('[role="button"][aria-roledescription]');
    await viewer.press("Enter");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    const before = requested.filter((url) => url.includes("/reference/")).length;
    await dialog.getByRole("button", { name: /お気に入りに追加/ }).click();
    await expect(dialog.getByRole("button", { name: /お気に入り.*解除/ })).toBeVisible();
    await expect(viewer).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveClass(/opacity-100/);
    expect(requested.filter((url) => url.includes("/reference/"))).toHaveLength(before);
  });

  for (const originalStatus of [200, 404]) {
    test(`non-four-digit serial uses original ${originalStatus} without derivative requests`, async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      await replaceFirstCatalogEntry(page, {
        entryType: "booth", displaySerial: "Booth0001", nickname: "Reference test product",
        sourceUrl: "", avatarUrl: "", boothUrl: "https://example.booth.pm/items/1", category: "Booth",
      });
      await page.route("**/reference/*.webp", (route) => route.fulfill({ status: 404, body: "no derivatives" }));
      await page.route("**/Booth0001.png", (route) => originalStatus === 200
        ? fulfillWebP(route) : route.fulfill({ status: 404, body: "no original" }));
      await page.route("**/api/avatar-image?id=0001**", fulfillWebP);
      await page.goto("/zukan");
      await expect(page.locator("article.akyo-card").first()).toContainText("Reference test product");
      const before = requested.length;
      const dialog = await openFirstAvatarDetail(page);
      const image = dialog.getByAltText("Reference test product", { exact: true });
      await expectImageLoaded(image);
      await expect(image).toHaveAttribute("src", originalStatus === 200 ? /\/Booth0001\.png$/ : /\/api\/avatar-image\?id=0001/);
      expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toHaveLength(0);
      expect(requested.slice(before).filter((url) => url.endsWith("/Booth0001.png"))).toHaveLength(1);
    });
  }

  test("world images keep their existing URL and dimensions without reference requests", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await replaceFirstCatalogEntry(page, {
      entryType: "world", displaySerial: "0109", nickname: "Reference test world",
      sourceUrl: "https://vrchat.com/home/world/wrld_reference-test",
      avatarUrl: "", category: "ワールド",
    });
    await page.route("**/api/vrc-world-image?wrld=wrld_reference-test**", fulfillWebP);
    await page.goto("/zukan");
    await page.getByRole("textbox", { name: "Akyo検索", exact: true }).fill("Reference test world");
    await expect(page.locator('article[aria-labelledby="card-title-0001"]')).toContainText("Reference test world");
    const before = requested.length;
    await page.locator('article[aria-labelledby="card-title-0001"] .detail-button').click();
    const dialog = page.getByRole("dialog");
    const image = dialog.getByAltText("Reference test world", { exact: true });
    await expectImageLoaded(image);
    await expect(image).toHaveAttribute("src", /\/api\/vrc-world-image\?wrld=wrld_reference-test&w=800$/);
    await expect(image).toHaveAttribute("width", "800");
    await expect(image).toHaveAttribute("height", "533");
    await dialog.locator('[role="button"][aria-roledescription]').press("Enter");
    await expect(dialog.locator("[data-reference-zoom-image]")).toHaveCount(0);
    expect(requested.slice(before).filter((url) => url.includes("/reference/"))).toHaveLength(0);
  });
});
