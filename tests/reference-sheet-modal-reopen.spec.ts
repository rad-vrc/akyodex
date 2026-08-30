import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const imageBody = readFileSync(
  path.join(process.cwd(), "public", "images", "profileIcon.webp"),
);

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

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "AKYO_LANG",
        value: "ja",
        url: "http://localhost:3000",
      },
    ]);
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
});
