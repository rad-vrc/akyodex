import { expect, test, type Page } from "@playwright/test";

/**
 * 縦積みになったグループと同じ行に並んだチップが、行の高さまで引き伸ばされないこと。
 *
 * CategoryBadges の外枠は flex-wrap で、既定の align-items は stretch。同じ行に
 * 「親の下に子が折り返した」2 行のグループが 1 つでもあると、隣の 1 行のグループが
 * 行の高さ（36px）まで伸び、さらにグループ自身も inline-flex なので中の親ピルも
 * stretch で 36px になる。パロディ（＋Lobotomy Corporation）と設備が並んだカードで
 * 設備だけ 2 行分の高さのチップに見えていた（2026-09-09 報告、1280px で実測）。
 *
 * 縦積みの印は JS（markStackedGroups）が付けるので、その行が実データに現れるかは
 * カードの幅とカテゴリの文字数しだいで安定しない。そこで実ページから本物のチップと
 * 本物の外枠クラスを取ってきて、印だけ手で付けた行を作って測る。マークアップと
 * クラスはコンポーネント由来なので、外枠から items-start が消えれば落ちる。
 */

const ONE_LINE = 18; // 11px × line-height 1.2727 ＋ 上下 2px パディング

type Probe = {
  rootClass: string;
  stackedGroupHeight: number;
  stackedParentHeight: number;
  soloGroupHeight: number;
  soloParentHeight: number;
  sameRow: boolean;
};

/** 本物のチップを複製し、片方だけ縦積みにした 1 行を作って高さを測る */
async function probeMixedRow(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll<HTMLElement>(".category-group")];
    const withChild = groups.find((g) => g.querySelector(".category-group__children"));
    const solo = groups.find((g) => !g.querySelector(".category-group__children"));
    if (!withChild || !solo) throw new Error("子付きのグループと単独チップが揃っていない");

    const root = withChild.parentElement;
    if (!root) throw new Error("外枠が見つからない");
    const rootClass = root.className;

    const box = document.createElement("div");
    box.className = rootClass;
    // 2 つが必ず同じ行に載る幅で、実ページのレイアウトに触れない位置に置く
    Object.assign(box.style, { position: "fixed", top: "0px", left: "0px", width: "600px" });

    const stacked = withChild.cloneNode(true) as HTMLElement;
    stacked.classList.add("category-group--stacked");
    const single = solo.cloneNode(true) as HTMLElement;
    box.append(stacked, single);
    document.body.append(box);

    const height = (el: Element) => Math.round(el.getBoundingClientRect().height * 10) / 10;
    const result = {
      rootClass,
      stackedGroupHeight: height(stacked),
      stackedParentHeight: height(stacked.querySelector(".category-group__parent")!),
      soloGroupHeight: height(single),
      soloParentHeight: height(single.querySelector(".category-group__parent")!),
      sameRow:
        Math.round(stacked.getBoundingClientRect().top) ===
        Math.round(single.getBoundingClientRect().top),
    };
    box.remove();
    return result;
  });
}

/** 実際に描かれているカードの親ピルの高さ（1 行を超えるものがあれば拾う） */
async function tallParentPills(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".category-group__parent")]
      .map((el) => ({
        text: el.textContent ?? "",
        height: Math.round(el.getBoundingClientRect().height * 10) / 10,
      }))
      .filter((pill) => pill.height > 20),
  );
}

async function openCatalog(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/zukan");
  await expect(page.locator("input.search-input")).toBeEnabled();
  await expect(page.locator(".category-group").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.describe("category badge row height", () => {
  test.use({ locale: "ja-JP" });

  for (const width of [1280, 768]) {
    test(`単独チップは縦積みの隣でも 1 行のまま（${width}px）`, async ({ page }) => {
      await openCatalog(page, width);
      const probe = await probeMixedRow(page);

      // 前提: 2 つが同じ行に載っていて、縦積み側は 2 行ぶんの高さになっている
      expect(probe.sameRow).toBe(true);
      expect(probe.stackedGroupHeight).toBeGreaterThan(ONE_LINE * 1.5);
      // 縦積み側の親ピル自身は 1 行。ここが伸びるなら別の不具合
      expect(probe.stackedParentHeight).toBeLessThan(ONE_LINE * 1.5);

      // 本題: 隣の単独チップは行の高さに引き伸ばされない
      expect(probe.soloGroupHeight).toBeLessThan(ONE_LINE * 1.5);
      expect(probe.soloParentHeight).toBeLessThan(ONE_LINE * 1.5);
    });
  }

  test("描かれているカードに 2 行分の高さの親ピルが無い", async ({ page }) => {
    await openCatalog(page, 1280);
    expect(await tallParentPills(page)).toEqual([]);
  });
});
