import { expect, test } from "@playwright/test";

const clearButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /検索をクリア|Clear search|검색 지우기/i });

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

  test("入力中はボタンが 44px 角以上で、テキストと重ならない", async ({ page }) => {
    await page.goto("/zukan");
    const input = page.locator("input.search-input");
    await input.fill("ミント");

    const button = clearButton(page);
    await expect(button).toBeVisible();

    const box = await button.boundingBox();
    expect(box, "クリアボタンの寸法を取得できなかった").not.toBeNull();

    // WCAG 2.2 の下限は SC 2.5.8 の 24px だが、この PR は SC 2.5.5(AAA) の
    // 44px を狙って広げている。24 で固定すると 25〜43px への縮小を見逃す。
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // マークアップ構造の変化と余白不足を切り分けられるよう、chip の存在を先に見る
    const chip = button.locator("span").first();
    await expect(chip, "チップ（button > span）が見つからない").toBeVisible();

    // 右余白がボタンの占有幅に足りていること（足りないとテキストが下に潜る）
    const clearance = await input.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const chipRect = el.parentElement!
        .querySelector("button span")!
        .getBoundingClientRect();
      const textRight =
        rect.right - parseFloat(styles.paddingRight) - parseFloat(styles.borderRightWidth);
      return chipRect.left - textRight;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
  });

});

test.describe("検索クリアボタンのホバー", () => {
  // タッチ端末では :hover が実機と挙動が違うので、デスクトップ相当で検証する
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test("当たり判定の外周をホバーしてもチップの色が変わる", async ({ page }) => {
    await page.goto("/zukan");
    const input = page.locator("input.search-input");
    await input.fill("ミント");

    const chip = clearButton(page).locator("span").first();
    const base = await chip.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    // 当たり判定 44px の外周（チップの外側）でも色が変わること。
    // span の :hover に直接置くと、押せるのに反応しない帯ができる。
    const box = (await clearButton(page).boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + box.height / 2);

    // transition-colors があるので、色が変わりきるまで待つ
    await expect
      .poll(() => chip.evaluate((el) => window.getComputedStyle(el).backgroundColor))
      .not.toBe(base);
  });
});
