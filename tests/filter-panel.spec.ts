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
    const authorSearch = page.getByPlaceholder(/作者を検索|Search authors|작가 검색/i);

    await expect(globalSearch).toBeVisible();
    await expect(authorSearch).toBeVisible();

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
