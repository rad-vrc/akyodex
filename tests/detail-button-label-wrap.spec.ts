import { expect, test, type Page } from "@playwright/test";

/**
 * 「くわしく見る」の折返しが、星の幅ではなく文節で決まること。
 *
 * 折返し位置は長らく絵文字 🌟 の字送り幅に偶然依存していて、星を 17px の SVG に
 * したときラベルの取り分が 75.2px → 85.2px に増え、「くわしく／見る」が
 * 「くわしく見／る」に動いた。単体テストは <wbr> の有無しか見られないので、
 * CSS 側（word-break: keep-all）が消えたら気づけるようにここで実際の行を見る。
 *
 * 表示言語は AKYO_LANG クッキーが無ければ navigator.language で決まるので、
 * ロケールを明示する。既定のまま走らせると英語になり、日本語の判定に入らない。
 */

/** テキストノードを 1 文字ずつ見て、描画上の行に分ける */
async function labelLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const label = document.querySelector(
      "article.akyo-card .detail-button .detail-label",
    );
    if (!label) throw new Error(".detail-label が見つからない");
    const texts: Text[] = [];
    const walk = (node: Node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) texts.push(child as Text);
        else if (child.nodeName !== "WBR") walk(child);
      }
    };
    walk(label);

    const range = document.createRange();
    const lines: string[] = [];
    let current = "";
    let lastTop: number | null = null;
    for (const text of texts) {
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const top = Math.round(range.getBoundingClientRect().top * 10) / 10;
        if (lastTop !== null && top !== lastTop) {
          lines.push(current);
          current = "";
        }
        current += text.data[i];
        lastTop = top;
      }
    }
    if (current) lines.push(current);
    return lines;
  });
}

/** ボタンの枠（padding box）で子が切られていないか */
async function clippedBy(page: Page) {
  return page.locator("article.akyo-card .detail-button").first().evaluate((el) => {
    const border = parseFloat(getComputedStyle(el).borderLeftWidth);
    const box = el.getBoundingClientRect();
    const kids = [...el.children].map((k) => k.getBoundingClientRect());
    return {
      left: Math.max(0, box.left + border - Math.min(...kids.map((k) => k.left))),
      right: Math.max(0, Math.max(...kids.map((k) => k.right)) - (box.right - border)),
    };
  });
}

async function openCatalog(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/zukan");
  await expect(page.locator("input.search-input")).toBeEnabled();
  const button = page.locator("article.akyo-card .detail-button").first();
  await button.scrollIntoViewIfNeeded();
  await expect(button.locator(".detail-label")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return button;
}

test.describe("detail button label wrapping (ja)", () => {
  test.use({ locale: "ja-JP" });

  // 1024px はカードが最も狭くなる幅（5列に切り替わる境目、カード幅 138px）。
  // 1280px は 2 行になる代表的なデスクトップ幅。
  for (const width of [1280, 1024]) {
    test(`wraps between phrases at ${width}px, not in the middle of one`, async ({ page }) => {
      const button = await openCatalog(page, width);
      const label = button.locator(".detail-label");

      // これが normal に戻ると漢字かな間のどこででも切れてしまう
      await expect(label).toHaveCSS("word-break", "keep-all");
      await expect(label).toHaveText("くわしく見る");

      expect(await labelLines(page)).toEqual(["くわしく", "見る"]);

      const clipped = await clippedBy(page);
      expect(clipped.left).toBeLessThan(0.5);
      expect(clipped.right).toBeLessThan(0.5);
    });
  }
});

test.describe("detail button label wrapping (en)", () => {
  test.use({ locale: "en-US" });

  // keep-all は空白での改行には影響しない。英語が語中で切れないことを押さえる。
  test("keeps English wrapping at the space", async ({ page }) => {
    const button = await openCatalog(page, 1280);
    await expect(button.locator(".detail-label")).toHaveText("View Details");

    const lines = await labelLines(page);
    expect(lines.map((line) => line.trim())).toEqual(["View", "Details"]);

    const clipped = await clippedBy(page);
    expect(clipped.left).toBeLessThan(0.5);
    expect(clipped.right).toBeLessThan(0.5);
  });
});
