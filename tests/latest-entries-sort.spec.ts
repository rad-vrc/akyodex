import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const catalog = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/akyo-data-ja.json"), "utf8"),
) as { data: Array<{ id: string; nickname: string }> };
const newest = [...catalog.data]
  .sort((a, b) => Number(b.id) - Number(a.id))
  .slice(0, 100);

async function expectOrder(page: Page, ascending: boolean, list: boolean) {
  const expected = ascending ? [...newest].reverse() : newest;
  const items = list
    ? page.locator(".list-view-table tbody tr td:nth-child(3) > div:first-of-type")
    : page.locator('article.akyo-card h3[id^="card-title-"]');
  const labels = expected.map((entry) => entry.nickname);

  await expect(items.first()).toHaveText(labels[0]);
  // Infinite rendering must not change either the selection or its order.
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    return items.count();
  }, { timeout: 15_000 }).toBe(100);
  await expect(items).toHaveText(labels);
}

for (const variant of [
  { name: "desktop cards", width: 1350, list: false },
  { name: "mobile cards", width: 390, list: false },
  { name: "desktop list", width: 1350, list: true },
]) {
  test.describe(variant.name, () => {
    test.use({
      viewport: { width: variant.width, height: 940 },
      serviceWorkers: "block",
      locale: "ja-JP",
    });

    test("sort toggles preserve the latest 100 entries", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/catalog/ja", (route) => route.fulfill({ json: catalog }));
      await page.goto("/zukan");
      if (variant.list) {
        await page.getByRole("button", { name: "リスト表示", exact: true }).click();
      }

      const sort = page.getByRole("button", { name: "ソート順の切り替え", exact: true });
      const latest = page.getByRole("button", { name: "最新100件表示の切り替え", exact: true });
      await expect(sort).toHaveAttribute("aria-pressed", "true");
      await latest.click();
      await expectOrder(page, true, variant.list);

      await sort.click();
      await expect(sort).toHaveAttribute("aria-pressed", "false");
      await expectOrder(page, false, variant.list);

      await sort.click();
      await expect(sort).toHaveAttribute("aria-pressed", "true");
      await expectOrder(page, true, variant.list);
      await expect(latest).toHaveAttribute("aria-pressed", "true");
      expect(errors).toEqual([]);
    });
  });
}
