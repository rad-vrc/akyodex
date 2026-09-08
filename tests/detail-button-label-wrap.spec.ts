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

/**
 * 描かれた文字と星が重なっていないか。
 *
 * 子要素の矩形だけ見ても足りない。ラベルの幅が 0px まで縮むと、文字は自分の箱の
 * 外へあふれて描かれるので、箱の位置は枠内なのに文字だけが星に重なる。
 * 文字を 1 つずつ Range で測って、星の矩形との交差を見る。
 */
async function glyphStarOverlap(page: Page) {
  return page.locator("article.akyo-card .detail-button").first().evaluate((btn) => {
    const label = btn.querySelector(".detail-label");
    if (!label) throw new Error(".detail-label が見つからない");
    const stars = [...btn.querySelectorAll("svg.detail-star")].map((s) =>
      s.getBoundingClientRect(),
    );

    const texts: Text[] = [];
    const walk = (node: Node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) texts.push(child as Text);
        else if (child.nodeName !== "WBR") walk(child);
      }
    };
    walk(label);

    // ボタンの内枠（padding box）。上下も見る。横しか見ないと、行が増えて
    // 下へあふれたときに気づけない。
    const style = getComputedStyle(btn);
    const bx = parseFloat(style.borderLeftWidth);
    const by = parseFloat(style.borderTopWidth);
    const box = btn.getBoundingClientRect();
    const inner = {
      left: box.left + bx,
      right: box.right - bx,
      top: box.top + by,
      bottom: box.bottom - by,
    };

    const range = document.createRange();
    let worst = 0;
    let where = "";
    const outside: string[] = [];
    for (const text of texts) {
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const g = range.getBoundingClientRect();
        if (g.width <= 0 || g.height <= 0) continue;
        if (
          g.left < inner.left - 0.5 ||
          g.right > inner.right + 0.5 ||
          g.top < inner.top - 0.5 ||
          g.bottom > inner.bottom + 0.5
        ) {
          outside.push(text.data[i]);
        }
        for (const s of stars) {
          const w = Math.min(g.right, s.right) - Math.max(g.left, s.left);
          const h = Math.min(g.bottom, s.bottom) - Math.max(g.top, s.top);
          if (w > 0.5 && h > 0.5 && w * h > worst) {
            worst = w * h;
            where = `${text.data[i]} が ${Math.round(w)}x${Math.round(h)}px`;
          }
        }
      }
    }
    return {
      area: Math.round(worst),
      where,
      outside: outside.join(""),
      labelWidth: label.getBoundingClientRect().width,
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

      // 収まれば 1 行、折り返すなら文節の切れ目で。語の途中では切らない。
      const lines = await labelLines(page);
      expect(["くわしく見る", "くわしく|見る"]).toContain(lines.join("|"));

      const clipped = await clippedBy(page);
      expect(clipped.left).toBeLessThan(0.5);
      expect(clipped.right).toBeLessThan(0.5);
    });
  }
});

/**
 * 条件その1: 文字だけ大きくする（rem ＝ レイアウトは据え置き）。
 * ブラウザの「最小フォントサイズ」を上げたときに近い。keep-all は「くわしく」を
 * 分割できない最小単位にするので、フレックスの自動最小サイズが効いて中身が
 * ボタンの外へ押し出され、overflow: hidden で切られていた（32px で星が左右
 * あわせて 46px）。min-width と overflow-wrap で最後の手段の分割を許し、
 * 左右パディングを 8px にして必要な幅を確保した。
 */
test.describe("detail button label wrapping (ja, enlarged text)", () => {
  test.use({ locale: "ja-JP" });

  for (const fontSize of [20, 32]) {
    test(`never clips the label or the stars at ${fontSize}px text`, async ({ page }) => {
      // 1024px はカードが最も狭くなる幅（カード幅 138px）
      const button = await openCatalog(page, 1024);
      await page.addStyleTag({ content: `body{font-size:${fontSize}px!important}` });
      await expect(button.locator(".detail-label")).toHaveCSS("font-size", `${fontSize}px`);

      const clipped = await clippedBy(page);
      expect(clipped.left).toBeLessThan(0.5);
      expect(clipped.right).toBeLessThan(0.5);
    });
  }
});

/**
 * 語間に空白がある言語。keep-all は空白での改行には影響しないので、折返しは
 * 語の切れ目のままのはず。行を空白でつなぎ直して元の文言に戻れば、どこも語の
 * 途中で切れていないと言える（1 行のときも成り立つ）。
 * 韓国語は keep-all の影響が最も大きい（語中で切れなくなる）ので、カードが
 * 最も狭くなる 1024px も必ず見る。
 */
for (const [name, locale, expected] of [
  ["en", "en-US", "View Details"],
  ["ko", "ko-KR", "자세히 보기"],
] as const) {
  test.describe(`detail button label wrapping (${name})`, () => {
    test.use({ locale });

    for (const width of [1280, 1024]) {
      test(`keeps ${name} wrapping at word boundaries at ${width}px`, async ({ page }) => {
        const label = (await openCatalog(page, width)).locator(".detail-label");
        await expect(label).toHaveText(expected);
        await expect(label).toHaveCSS("word-break", "keep-all");

        const rendered = (await labelLines(page))
          .map((line) => line.trim())
          .filter(Boolean);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.join(" ")).toBe(expected);

        const clipped = await clippedBy(page);
        expect(clipped.left).toBeLessThan(0.5);
        expect(clipped.right).toBeLessThan(0.5);
      });
    }
  });
}

/**
 * 条件その2: ルートの文字サイズを上げる（rem も変わるのでレイアウトも動く）。
 * DevTools で `document.documentElement.style.fontSize = "200%"` としたのと同じ。
 * 1024px ではカードが 138px → 77.2px まで細るので、その1 より厳しい。
 *
 * ここでラベルの下限が 0 だと箱の幅が 0 になり、そこから描かれた文字が箱の外へ
 * あふれて星と重なった（実測: 韓国語「히」と星が 16×17px、日本語「し」で
 * 16×7.5px、英語 "e" で 2.7×17px）。ボタンの枠は超えないので、子要素の矩形を
 * 見るだけでは気づけない。
 */
for (const [name, locale] of [
  ["ja", "ja-JP"],
  ["ko", "ko-KR"],
  ["en", "en-US"],
] as const) {
  test.describe(`detail button label at 200% root font size (${name})`, () => {
    test.use({ locale });

    test("never overlaps or clips the stars", async ({ page }) => {
      const button = await openCatalog(page, 1024);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await expect(button.locator(".detail-label")).toHaveCSS("font-size", "32px");

      const overlap = await glyphStarOverlap(page);
      expect(overlap.where).toBe("");
      expect(overlap.area).toBe(0);
      // ボタンの内枠から出た文字がないこと（上下も見る）
      expect(overlap.outside).toBe("");
      // 幅 0 まで縮んでいないこと（縮むと文字が箱の外へ出る）
      expect(overlap.labelWidth).toBeGreaterThan(0);

      const clipped = await clippedBy(page);
      expect(clipped.left).toBeLessThan(0.5);
      expect(clipped.right).toBeLessThan(0.5);
    });
  });
}
