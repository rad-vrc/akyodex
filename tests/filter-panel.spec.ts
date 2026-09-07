import { expect, test } from "@playwright/test";

test.describe("Filter panel responsive defaults", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });

  test("mobile view keeps the filter panel closed after hydration", async ({ page }) => {
    await page.goto("/zukan");
    await page.waitForSelector(".akyo-card", { state: "attached" });

    const toggleButton = page.getByRole("button", { name: /絞り込みフィルタを開く|Open filters|필터 열기/i });
    const filterPanel = page.locator("#zukan-filter-panel");

    await expect(toggleButton).toBeVisible();
    await expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    await expect(filterPanel).toBeHidden();
  });
});

test.describe("Search input focus styling", () => {
  test("global search focus outline matches the author filter search input", async ({ page }) => {
    await page.goto("/zukan");
    await page.waitForSelector(".akyo-card", { state: "attached" });

    const globalSearch = page.locator("input.search-input");
    const authorSearch = page.getByPlaceholder(/作者名を検索|Search authors|작가 검색/i);

    await expect(globalSearch).toBeEnabled();
    await expect(globalSearch).toBeVisible();
    await expect(authorSearch).toBeVisible();
    await expect(authorSearch).toBeEnabled();

    const readFocusStyles = async (selector: typeof globalSearch) => {
      await selector.focus();
      return selector.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        const normalizeColor = (value: string) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context) return value;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          return `${r},${g},${b},${a}`;
        };
        const normalizeBoxShadow = (value: string) =>
          value
            .split(/,(?![^()]*\))/)
            .map((shadow) => shadow.trim())
            .map((shadow) => {
              const colorMatch = shadow.match(/(rgba?\([^)]+\)|oklab\([^)]+\)|lab\([^)]+\))/);
              const colorToken = colorMatch?.[0] ?? "";
              return {
                geometry: shadow.replace(colorToken, "").replace(/\s+/g, " ").trim(),
              };
            })
            .filter(
              ({ geometry }) => geometry !== "0px 0px 0px 0px",
            )
            .map(({ geometry }) => geometry);

        return {
          outlineStyle: styles.outlineStyle,
          outlineWidth: styles.outlineWidth,
          borderColor: normalizeColor(styles.borderTopColor),
          boxShadow: normalizeBoxShadow(styles.boxShadow),
        };
      });
    };

    const authorFocusStyles = await readFocusStyles(authorSearch);
    const globalFocusStyles = await readFocusStyles(globalSearch);

    expect(authorFocusStyles.boxShadow).toContain("0px 0px 0px 2px");
    expect(globalFocusStyles.boxShadow).toContain("0px 0px 0px 2px");
    expect(globalFocusStyles).toEqual(authorFocusStyles);
  });
});

test.describe("検索クリアボタンの寸法と余白", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  const clearButton = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /検索をクリア|Clear search|검색 지우기/i });

  const paddingOf = (input: ReturnType<import("@playwright/test").Page["locator"]>) =>
    input.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        left: parseFloat(styles.paddingLeft),
        right: parseFloat(styles.paddingRight),
      };
    });

  test("空欄ではクリア用の右余白を確保しない", async ({ page }) => {
    await page.goto("/zukan");
    const input = page.locator("input.search-input");
    await expect(input).toBeEnabled();

    // ボタンが無いのに右を空けると、その分だけプレースホルダの表示幅が削られる
    await expect(clearButton(page)).toHaveCount(0);
    expect((await paddingOf(input)).right).toBeLessThan(30);
  });

  test("入力中はボタンが 24px 角以上で、テキストと重ならない", async ({ page }) => {
    await page.goto("/zukan");
    const input = page.locator("input.search-input");
    await input.fill("ミント");

    const button = clearButton(page);
    await expect(button).toBeVisible();

    const box = await button.boundingBox();
    // WCAG 2.2 SC 2.5.8 Target Size (Minimum)
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);

    // 右余白がボタンの占有幅に足りていること（足りないとテキストが下に潜る）
    const clearance = await input.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const chip = el.parentElement
        ?.querySelector("button span")
        ?.getBoundingClientRect();
      if (!chip) return -1;
      const textRight =
        rect.right - parseFloat(styles.paddingRight) - parseFloat(styles.borderRightWidth);
      return chip.left - textRight;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
  });

  test("有効時のホバーでチップの色が変わる", async ({ page }) => {
    await page.goto("/zukan");
    const input = page.locator("input.search-input");
    await input.fill("ミント");

    const chip = clearButton(page).locator("span").first();
    const base = await chip.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    await clearButton(page).hover();

    // transition-colors があるので、色が変わりきるまで待つ。
    // disabled のときはこのクラス自体を付けないので、ここでは有効時だけを見る。
    await expect
      .poll(() => chip.evaluate((el) => window.getComputedStyle(el).backgroundColor))
      .not.toBe(base);
  });
});
