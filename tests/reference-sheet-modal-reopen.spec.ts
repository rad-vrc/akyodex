import { expect, test, type Locator, type Page } from "@playwright/test";
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

test.describe("Reference sheet modal reopen", () => {
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

  test("does not leave a loading status after reopening an already loaded image", async ({
    page,
  }) => {
    let transformedImageRequestCount = 0;
    await page.route("**/api/reference-image?id=0001", async (route) => {
      transformedImageRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: imageBody,
      });
    });
    await page.route("**/0001.png", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: imageBody,
      }),
    );

    await page.goto("/zukan");

    let dialog = await openFirstAvatarDetail(page);
    let detailImage = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expect(detailImage).toHaveAttribute("src", /\/0001\.png$/);
    await expectImageLoaded(detailImage);
    await expect(dialog.getByRole("status")).toHaveCount(0);

    await dialog
      .getByRole("button", { name: /閉じる|Close|닫기/i })
      .click();
    await expect(dialog).toBeHidden();

    dialog = await openFirstAvatarDetail(page);
    detailImage = dialog.getByAltText("オリジンAkyo", { exact: true });
    await expectImageLoaded(detailImage);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    expect(transformedImageRequestCount).toBe(0);
  });

  test("keeps a successful WebP fallback accessible after the PNG fails", async ({
    page,
  }) => {
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
    await page.route("**/api/avatar-image?id=0001**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: imageBody,
      }),
    );

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const fallbackImage = dialog.locator('img[src*="/api/avatar-image?id=0001"]');

    await expectImageLoaded(fallbackImage);
    await expect(fallbackImage).toHaveAttribute("alt", "オリジンAkyo");
    await expect(fallbackImage).not.toHaveAttribute("role", "presentation");
    await expect(fallbackImage).not.toHaveAttribute("style", /linear-gradient/);
  });
});
