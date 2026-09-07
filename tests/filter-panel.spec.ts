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

test.describe("絞り込み入力のクリアボタン", () => {
  // カテゴリ側とパネル全体はデスクトップで開いた状態を見る
  test.use({ viewport: { width: 1280, height: 1000 }, isMobile: false, hasTouch: false });

  const cases = [
    {
      name: "カテゴリ",
      placeholder: /カテゴリ名を検索|Search categories|카테고리 검색/i,
      clear: /カテゴリ名の検索をクリア|Clear category search|카테고리 검색 지우기/i,
      text: "エネ",
      // orange-600 の実レンダリング値（Tailwind v4 は oklch 定義なので #ea580c とは一致しない）。
      // orange-500 は白に対して 2.80:1 で SC 1.4.11 に届かない
      chip: "rgb(245, 74, 0)",
      chipHover: "rgb(202, 53, 0)",
    },
    {
      name: "作者",
      placeholder: /作者名を検索|Search authors|작자 검색/i,
      clear: /作者名の検索をクリア|Clear author search|작자 검색 지우기/i,
      text: "ug",
      // --accent-blue
      chip: "rgb(43, 127, 255)",
      chipHover: "rgb(29, 78, 216)",
    },
  ];

  for (const { name, placeholder, clear, text, chip, chipHover } of cases) {
    test(`${name}: 空欄ではボタンも右余白も出さない`, async ({ page }) => {
      await page.goto("/zukan");
      const input = page.getByPlaceholder(placeholder);
      await expect(input).toBeVisible();

      await expect(page.getByRole("button", { name: clear })).toHaveCount(0);
      const padding = await input.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).paddingRight),
      );
      expect(padding).toBeLessThan(20);
    });

    test(`${name}: 入力中はボタンが 24px 角以上で、テキストと重ならない`, async ({ page }) => {
      await page.goto("/zukan");
      const input = page.getByPlaceholder(placeholder);
      await input.fill(text);

      const button = page.getByRole("button", { name: clear });
      await expect(button).toBeVisible();

      const box = await button.boundingBox();
      expect(box, "クリアボタンの寸法を取得できなかった").not.toBeNull();
      // 入力欄の高さが 40px なので 44px は入らない。SC 2.5.8 の 24px を下限にする
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
      // 枠の内側に収まっていること
      const inputBox = (await input.boundingBox())!;
      expect(box!.height).toBeLessThanOrEqual(inputBox.height);

      const clearance = await input.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const chip = el.parentElement!.querySelector("button span")!.getBoundingClientRect();
        const textRight =
          rect.right - parseFloat(styles.paddingRight) - parseFloat(styles.borderRightWidth);
        return chip.left - textRight;
      });
      expect(clearance).toBeGreaterThanOrEqual(0);
    });

    test(`${name}: チップの地色が系統どおり`, async ({ page }) => {
      await page.goto("/zukan");
      await page.getByPlaceholder(placeholder).fill(text);

      // 取り違えると見た目が入れ替わるだけで寸法テストは通ってしまう
      const chipEl = page.getByRole("button", { name: clear }).locator("span").first();
      const actual = await chipEl.evaluate((el) => {
        const canvas = document.createElement("canvas").getContext("2d");
        if (!canvas) return "";
        canvas.fillStyle = window.getComputedStyle(el).backgroundColor;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
      expect(actual).toBe(chip);
    });

    test(`${name}: 押すと入力が空になる`, async ({ page }) => {
      await page.goto("/zukan");
      const input = page.getByPlaceholder(placeholder);
      await input.fill(text);

      await page.getByRole("button", { name: clear }).click();
      await expect(input).toHaveValue("");
      await expect(page.getByRole("button", { name: clear })).toHaveCount(0);
      // ボタンが消えるので、戻さないとフォーカスが body に落ちる
      await expect(input).toBeFocused();
    });

    test(`${name}: 当たり判定の外周をホバーしてもチップの色が変わる`, async ({ page }) => {
      await page.goto("/zukan");
      await page.getByPlaceholder(placeholder).fill(text);

      const button = page.getByRole("button", { name: clear });
      const chipEl = button.locator("span").first();
      const readColor = () =>
        chipEl.evaluate((el) => {
          const canvas = document.createElement("canvas").getContext("2d");
          if (!canvas) return "";
          canvas.fillStyle = window.getComputedStyle(el).backgroundColor;
          canvas.fillRect(0, 0, 1, 1);
          const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        });

      // チップの外側（押せるのに反応しない帯ができていないか）
      const box = (await button.boundingBox())!;
      await page.mouse.move(box.x + 3, box.y + box.height / 2);
      await expect.poll(readColor).toBe(chipHover);
    });
  }
});

test.describe("検索プレースホルダの幅による出し分け", () => {
  // placeholder は属性なので CSS では切り替えられない。幅で出し分けている。
  const FULL = /アバター・ワールド・作者・カテゴリ名で検索|Search by avatar, world, author|아바타・월드・작자/;
  const COMPACT = /アバター・ワールド名で検索|Search avatars and worlds|아바타・월드 이름으로/;

  test("狭い画面では短い方を出す", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/zukan");

    // サーバーは広い方を返すので、狭い方への切り替わりはハイドレーション後
    const input = page.locator("input.search-input");
    await expect(input).toHaveAttribute("placeholder", COMPACT);
  });

  test("sm 以上では長い方を出し、入力欄に収まる", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto("/zukan");

    const input = page.locator("input.search-input");
    await expect(input).toHaveAttribute("placeholder", FULL);

    // 640px で切れ始めると、この出し分け自体が意味を失う
    const fits = await input.evaluate((el: HTMLInputElement) => {
      const styles = window.getComputedStyle(el);
      const canvas = document.createElement("canvas").getContext("2d");
      if (!canvas) return true;
      canvas.font = `${styles.fontSize} ${styles.fontFamily}`;
      const available =
        el.getBoundingClientRect().width -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight) -
        parseFloat(styles.borderLeftWidth) -
        parseFloat(styles.borderRightWidth);
      return canvas.measureText(el.placeholder).width <= available;
    });
    expect(fits).toBe(true);
  });
});
