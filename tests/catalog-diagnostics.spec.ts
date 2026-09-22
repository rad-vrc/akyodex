import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Event } from "@sentry/react";

// Run with playwright.catalog-diagnostics.config.ts: its DSN points only at localhost.
test("the actual catalog view reports a slow success after enabling the filters", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://localhost:3517", "requires the dedicated local-only telemetry configuration");
  const events: Event[] = [];
  await page.context().addCookies([{ name: "AKYO_LANG", value: "ja", url: baseURL! }]);
  await page.route("**/api/1/envelope/**", async (route) => {
    const lines = (route.request().postData() ?? "").split("\n");
    for (let i = 1; i + 1 < lines.length; i += 2) {
      if (JSON.parse(lines[i]).type === "event") events.push(JSON.parse(lines[i + 1]));
    }
    await route.fulfill({ json: {} });
  });
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/catalog/ja", async (route) => {
    await held;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Server-Timing": 'catalog_kv;dur=3100, catalog_handler;dur=3120, catalog_worker;dur=3150, catalog_source;desc="kv-payload", catalog_generated;desc="1000"' },
      body: readFileSync("data/akyo-data-ja.json", "utf8"),
    });
  });
  try {
    await page.goto("/zukan", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => performance.getEntriesByName("catalog-fetch-start").length > 0);
    await expect(page.locator("article.akyo-card")).toHaveCount(12);
    await expect(page.locator("input.search-input")).toBeDisabled();
    // Deliberately cross the diagnostic threshold, after the fetch measurement starts.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    release!();
    await expect(page.locator("input.search-input")).toBeEnabled();
    await expect(page.locator("#zukan-filter-panel > fieldset")).not.toHaveAttribute("disabled", "");
    const slowEvents = () => events.filter((event) => event.fingerprint?.includes("catalog-slow-load"));
    await expect.poll(() => slowEvents().length).toBe(1);
    const event = slowEvents()[0];
    expect(event.extra?.durationMs).toBeGreaterThanOrEqual(3000);
    const requests = event.extra?.requests as Record<string, unknown>[];
    expect(requests[0].catalog_kv).toBe(3100);
    expect(requests[0].headersWaitMs).toBeGreaterThanOrEqual(3000);
    expect(requests[0].serverSource).toBe("kv-payload");
    await page.locator("input.search-input").fill("Akyo");
    expect(slowEvents()).toHaveLength(1);
  } finally { release?.(); }
});
