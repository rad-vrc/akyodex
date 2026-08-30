import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const imageBody = readFileSync(
  path.join(process.cwd(), "public", "images", "profileIcon.webp"),
);

async function openFirstAvatarDetail(page: Page) {
  const firstCard = page.locator("article.akyo-card").first();
  await expect(firstCard).toBeVisible();
  await firstCard.locator(".detail-button").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Reference sheet detail images", () => {
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

  test("requests the optimized image only after the modal opens", async ({
    page,
  }) => {
    let referenceRequestCount = 0;
    await page.route("**/api/reference-image?id=0001", async (route) => {
      referenceRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        headers: { "X-Image-Transformed": "true" },
        body: imageBody,
      });
    });

    await page.goto("/zukan");
    await expect(page.locator("article.akyo-card").first()).toBeVisible();
    expect(referenceRequestCount).toBe(0);

    const dialog = await openFirstAvatarDetail(page);
    const detailImage = dialog.getByAltText("オリジンAkyo", {
      exact: true,
    });
    await expect(detailImage).toHaveAttribute(
      "src",
      /\/api\/reference-image\?id=0001$/,
    );
    await expect(detailImage).toHaveAttribute("loading", "eager");
    await expect(detailImage).toHaveAttribute("fetchpriority", "high");
    await expect(detailImage).toHaveAttribute("width", "1920");
    await expect(detailImage).toHaveAttribute("height", "1080");
    await expect.poll(() => referenceRequestCount).toBe(1);
  });

  test("falls back to the original PNG when transformation fails", async ({
    page,
  }) => {
    await page.route("**/api/reference-image?id=0001", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        json: { success: false, error: "Transformation failed" },
      }),
    );
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: imageBody }),
    );

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    await expect(
      dialog.getByAltText("オリジンAkyo", { exact: true }),
    ).toHaveAttribute("src", /\/0001\.png$/);
  });

  test("falls back to the card image when the original PNG is missing", async ({
    page,
  }) => {
    await page.route("**/api/reference-image?id=0001", (route) =>
      route.fulfill({ status: 502, body: "" }),
    );
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/api/avatar-image?id=0001*&w=800", (route) =>
      route.fulfill({ status: 200, contentType: "image/webp", body: imageBody }),
    );

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    await expect(
      dialog.getByAltText("オリジンAkyo", { exact: true }),
    ).toHaveAttribute("src", /\/api\/avatar-image\?.*w=800/);
  });

  test("settles without a broken image when every source fails", async ({
    page,
  }) => {
    await page.route("**/api/reference-image?id=0001", (route) =>
      route.fulfill({ status: 502, body: "" }),
    );
    await page.route("**/0001.png", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/api/avatar-image?id=0001*&w=800", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );

    await page.goto("/zukan");
    const dialog = await openFirstAvatarDetail(page);
    const zoomButton = dialog.getByRole("button", {
      name: /オリジンAkyo 画像のズーム切り替え/,
    });
    await expect(zoomButton.locator("img")).toHaveCount(0);
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });
});
