import { devices, expect, test, type Page } from "@playwright/test";

/**
 * タッチ端末で「くわしく見る」のホバー演出が貼りついたままにならないこと。
 *
 * タッチ端末は :hover を「タップした要素に付けたまま、次にどこかを触るまで残す」
 * 形で模倣する。そのため波紋は全開（scale 1 / opacity 1）で固まり、ボタンも
 * 拡大＋傾き＋金枠のまま止まっていた。詳細モーダルを閉じても戻らない。
 * 直し方はホバー演出を @media (hover: hover) の中に閉じ込めること。
 * ここでは :hover が付いたままでも見た目が変わらないことを確認する。
 */

async function buttonState(page: Page) {
  return page.locator("article.akyo-card .detail-button").first().evaluate((el) => {
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    return {
      transform: style.transform,
      borderColor: style.borderTopColor,
      // 疑似要素そのものが作られていなければ content は "none"
      rippleContent: after.content,
      hovered: el.matches(":hover"),
    };
  });
}

/**
 * カタログは読み込み中にレイアウトが動く（実測でボタンの y が 486.66 → 411.44 と
 * 75px ずれた）。位置が 2 回続けて同じになるまで待ってから座標を返す。
 * 動いている最中の座標へマウスを運ぶと、ボタンの外に乗ってホバーが付かない。
 */
async function settledBox(button: ReturnType<Page["locator"]>) {
  let previous: string | null = null;
  for (let i = 0; i < 25; i++) {
    const box = await button.boundingBox();
    if (!box) throw new Error("ボタンの位置が取れない");
    const key = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}`;
    if (key === previous) return box;
    previous = key;
    await button.page().waitForTimeout(200);
  }
  throw new Error("ボタンの位置が落ち着かない");
}

async function openCatalog(page: Page) {
  await page.goto("/zukan");
  await expect(page.locator("input.search-input")).toBeEnabled();
  const button = page.locator("article.akyo-card .detail-button").first();
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return button;
}

// devices をそのまま展開すると defaultBrowserType が入り、describe 単位の
// test.use では受け付けられない（ワーカーを作り直す設定のため）。
// タッチかどうかを決める項目だけを取る。
const PIXEL_7 = devices["Pixel 7"];

test.describe("detail button on touch devices", () => {
  test.use({
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: PIXEL_7.deviceScaleFactor,
    isMobile: PIXEL_7.isMobile,
    hasTouch: PIXEL_7.hasTouch,
  });

  test("tapping never leaves the hover ripple or lift stuck on", async ({ page }) => {
    const button = await openCatalog(page);

    const before = await buttonState(page);
    expect(before.rippleContent).toBe("none"); // 波紋の疑似要素を作らない
    expect(before.transform).toBe("none");

    const box = await settledBox(button);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    // タップで詳細モーダルが開くこと（ホバー演出を止めても押せる）
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 閉じたあと :hover は残るが、見た目は元のままであること。
    // :active のトランジションは cubic-bezier がオーバーシュートするので、
    // 一発読みだと戻りきる前の値を拾う。落ち着くまで待つ。
    await expect.poll(async () => (await buttonState(page)).transform).toBe("none");

    const after = await buttonState(page);
    expect(after.hovered).toBe(true);
    expect(after.rippleContent).toBe("none");
    expect(after.borderColor).toBe(before.borderColor);
  });
});

test.describe("detail button on pointing devices", () => {
  // ホバーできる環境では従来どおり動くこと（タッチ側の対処で殺していない）
  test("hover still lifts the button and plays the ripple", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const button = await openCatalog(page);

    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await buttonState(page)).transform)
      .toBe("none");
    expect((await buttonState(page)).rippleContent).toBe('""');

    const box = await settledBox(button);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await buttonState(page)).hovered).toBe(true);

    // 波紋が広がりきり、ボタンが持ち上がること。
    // トランジションの途中を拾わないよう、落ち着くまで待って比べる。
    const ripple = () =>
      page.locator("article.akyo-card .detail-button").first().evaluate((el) => {
        const after = getComputedStyle(el, "::after");
        const matrix = after.transform.match(/matrix\(([-\d.]+)/);
        return {
          scale: matrix ? Number(matrix[1]) : 0,
          opacity: Number(after.opacity),
        };
      });
    await expect.poll(async () => (await ripple()).scale > 0.99).toBe(true);
    expect((await ripple()).opacity).toBeGreaterThan(0.99);
    expect((await buttonState(page)).transform).not.toBe("none");

    // 離れたら消えること
    await page.mouse.move(0, 0);
    await expect
      .poll(async () =>
        page.locator("article.akyo-card .detail-button").first().evaluate((el) =>
          Number(getComputedStyle(el, "::after").opacity),
        ),
      )
      .toBe(0);
    await expect.poll(async () => (await buttonState(page)).transform).toBe("none");
  });
});
