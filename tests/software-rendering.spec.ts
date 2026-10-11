import { expect, test } from '@playwright/test';

test.use({
  locale: 'ja-JP',
  serviceWorkers: 'block',
  launchOptions: { args: ['--disable-gpu'] },
  deviceScaleFactor: 0.8,
});

test('software-rendered editor keeps its scroll surface, sticky headings and pending edits', async ({ page, browser }) => {
  const cdp = await browser.newBrowserCDPSession();
  const { gpu } = await cdp.send('SystemInfo.getInfo');
  expect(gpu.featureStatus).toMatchObject({ gpu_compositing: 'disabled_software' });
  await cdp.detach();
  // Approximate 3840x2160 at 80% zoom, with Windows display scaling at 100%.
  await page.setViewportSize({ width: 4800, height: 2700 });
  await page.route('**/api/admin/verify-session', route => route.fulfill({
    json: { authenticated: true, role: 'owner' },
  }));
  await page.route('**/api/admin/next-id', route => route.fulfill({ json: { nextId: '9999' } }));
  await page.route('**/*', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
    return route.fallback();
  });
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-effects', 'true');
  await page.getByRole('button', { name: '編集・削除', exact: true }).click();
  const table = page.locator('table');
  const scrollport = table.locator('..');
  await expect(scrollport).toHaveCSS('will-change', 'transform');
  await scrollport.evaluate(el => { el.scrollTop = 1000; });
  await expect.poll(() => scrollport.evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  const header = table.locator('thead');
  await expect(header).toBeVisible();
  await expect.poll(async () => {
    const h = await header.boundingBox();
    const s = await scrollport.boundingBox();
    return Math.abs(h!.y - s!.y);
  }).toBeLessThan(2);
  await page.getByPlaceholder('ID、名前、アバター名、作者で検索').fill('0001');
  await page.getByRole('button', { name: '編集', exact: true }).first().click();
  await expect(page.locator('#edit-nickname')).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(4800);
  await page.locator('#edit-nickname').fill('Software rendering pending fixture');
  await page.getByRole('button', { name: '更新を保留', exact: true }).click();
  await expect(page.getByText('保留 1件', { exact: true })).toBeVisible();
});

test('unavailable graphics automatically remove decorative surfaces across routes', async ({ page }) => {
  await page.route('**/*', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
    return route.fallback();
  });
  await page.goto('/zukan');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-effects', 'true');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::before').display)).toBe('none');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::after').display)).toBe('none');
  await page.waitForTimeout(4000); // Past the deferred decoration activation.
  await expect(page.locator('#miniAkyoBg')).toHaveCount(0);
  await expect(page.locator('.akyo-card').first()).toBeVisible();
  await expect(page.locator('[class*="backdrop-blur"]').first()).toHaveCSS('backdrop-filter', 'none');
  await page.evaluate(() => { document.documentElement.dataset.spaFixture = 'preserved'; });
  await page.locator('a[href="/admin"]').last().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('html')).toHaveAttribute('data-spa-fixture', 'preserved');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-effects', 'true');
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').display)).toBe('none');
});

test('a usable non-software context preserves the normal background and animation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type, ...args) {
      if (type === 'webgl') return {
        isContextLost: () => false,
        RENDERER: 7937,
        getParameter: () => 'Hardware rendering fixture',
        getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext() {} } : null,
      } as unknown as WebGLRenderingContext;
      return original.call(this, type, ...args);
    } as typeof original;
  });
  await page.goto('/zukan');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-effects', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').display)).not.toBe('none');
  await expect(page.locator('#miniAkyoBg')).toBeAttached({ timeout: 15_000 });
});

for (const locale of ['ja-JP', 'en-US', 'ko-KR']) {
  test.describe(`reduced effects on mobile (${locale})`, () => {
    test.use({ locale, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

    test('keeps translated controls, search, content images and the detail dialog', async ({ page }, testInfo) => {
      await page.route('**/*', route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
        return route.fallback();
      });
      await page.goto('/zukan');
      await expect(page.locator('html')).toHaveAttribute('data-reduced-effects', 'true');
      const search = page.locator('input.search-input');
      await expect(search).toBeEnabled();
      await search.fill('0001');
      const card = page.locator('article.akyo-card').first();
      await expect(card).toBeVisible();
      await expect.poll(() => card.locator('img').first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      const detail = card.locator('.detail-button');
      await expect(detail).toHaveAccessibleName(/くわしく見る|View Details|자세히 보기/i);
      await detail.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
      await expect.poll(() => page.locator('[data-reference-primary-image]').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath('mobile-detail.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(detail).toBeFocused();
    });
  });
}
