import { expect, test } from "@playwright/test";

test.describe("Issue #320 accessibility regressions", () => {
  test("P0: skip link, keyboard-open card, and modal focus management work on /zukan", async ({
    page,
  }) => {
    await page.goto("/zukan");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", {
      name: /メインコンテンツへスキップ|Skip to main content|주요 콘텐츠로 건너뛰기/i,
    });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();

    const firstCard = page.locator("article.akyo-card button[data-card-trigger='true']").first();
    await firstCard.focus();
    await expect(firstCard).toBeFocused();

    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const closeButton = dialog.getByRole("button", { name: /閉じる|Close|닫기/i });
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(closeButton).not.toBeFocused();
    await expect(dialog.locator(":focus")).toHaveCount(1);

    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(firstCard).toBeFocused();
  });

  test("P1: /zukan exposes navigation landmarks, heading structure, semantic stats, and strong search focus", async ({
    page,
  }) => {
    await page.goto("/zukan");

    await expect(page.getByRole("navigation")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const statsList = page.locator("header dl");
    await expect(statsList).toBeVisible();
    await expect(statsList.locator("dt")).toHaveCount(3);

    const searchInput = page.locator(".search-input");
    await searchInput.focus();

    const focusStyles = await searchInput.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
        boxShadow: styles.boxShadow,
      };
    });

    const normalizedOutlineStyle = focusStyles.outlineStyle.trim().toLowerCase();
    const normalizedBoxShadow = focusStyles.boxShadow.trim().toLowerCase();
    const hasOutline =
      ((normalizedOutlineStyle === "auto" &&
        !["none", "hidden", ""].includes(normalizedOutlineStyle)) ||
        (!["none", "hidden", ""].includes(normalizedOutlineStyle) &&
          Number.parseFloat(focusStyles.outlineWidth) >= 1));
    const hasVisibleShadow = !["none", "0px 0px 0px", "0px 0px 0px 0px"].includes(
      normalizedBoxShadow,
    );

    expect(hasOutline || hasVisibleShadow).toBeTruthy();

    await searchInput.fill("test");
    await page.getByRole("button", { name: /検索をクリア|Clear search|검색 지우기/i }).click();
    await expect(searchInput).toBeFocused();

    await page.getByRole("button", { name: /リスト|List|목록/i }).click();

    const scopeValues = await page
      .locator(".list-view-table thead th")
      .evaluateAll((headers) => headers.map((header) => header.getAttribute("scope")));

    expect(scopeValues.length).toBeGreaterThan(0);
    expect(scopeValues.every((scopeValue) => scopeValue === "col")).toBeTruthy();
  });

  test("P1: offline and admin login controls expose proper semantics", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("button", { name: /再読み込み/i })).toHaveAttribute(
      "type",
      "button",
    );

    await page.goto("/admin");
    await expect(page.getByLabel(/Akyoワード/i)).toHaveAttribute("type", "password");
  });

  test("P2: toggles, chatbot region, modal alt text, and decorative emoji semantics are accessible", async ({
    page,
  }) => {
    await page.goto("/zukan");

    await expect(page.getByRole("button", { name: /カード|Card|카드/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /リスト|List|목록/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await expect(page.getByRole("complementary", { name: /AI|チャット|채팅/i })).toHaveCount(1);
    await expect(
      page.locator("span[aria-hidden='true']").filter({ hasText: "🔍" }).first(),
    ).toBeVisible();

    const firstCardArticle = page.locator("article.akyo-card").first();
    const firstCard = firstCardArticle.locator("button[data-card-trigger='true']");
    await expect(
      firstCardArticle.locator("button.detail-button span[aria-hidden='true']").filter({ hasText: "🌟" }),
    ).toHaveCount(2);

    await firstCard.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img[alt="Profile Icon"]')).toHaveCount(0);
    const zoomControl = dialog.locator('[role="button"][aria-pressed]').first();
    await zoomControl.focus();
    await expect(zoomControl).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(zoomControl).toHaveAttribute("aria-pressed", "true");
    await expect(
      dialog.locator("span[aria-hidden='true']").filter({ hasText: "✨" }),
    ).toHaveCount(1);
  });
});
