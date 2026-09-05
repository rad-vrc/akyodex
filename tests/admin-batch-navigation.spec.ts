import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', locale: 'ja-JP' });

async function openEditor(page: Page) {
  await page.route('**/api/admin/verify-session', (route) => route.fulfill({
    json: { authenticated: true, role: 'owner' },
  }));
  await page.route('**/api/admin/next-id', (route) => route.fulfill({ json: { nextId: '9999' } }));
  // Never let the authenticated UI fixture perform a real mutation.
  await page.route('**/api/**', (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
    return route.fallback();
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '編集・削除', exact: true }).click();
}

async function holdEdit(page: Page) {
  await page.getByPlaceholder('ID、名前、アバター名、作者で検索').fill('0001');
  await page.getByRole('button', { name: '編集', exact: true }).first().click();
  await page.locator('#edit-nickname').fill('Pending navigation fixture');
  await page.getByRole('button', { name: '更新を保留', exact: true }).click();
  await expect(page.getByText('保留 1件', { exact: true })).toBeVisible();
}

test('Next Link cancel preserves pending edits; accepting discards and navigates', async ({ page }) => {
  await openEditor(page);
  await holdEdit(page);
  const messages: string[] = [];
  const dismiss = async (dialog: import('@playwright/test').Dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await page.getByRole('link', { name: '図鑑に戻る' }).click();
  await expect.poll(() => messages.length).toBe(1);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('保留 1件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '編集', exact: true }).first().click();
  await expect(page.locator('#edit-nickname')).toHaveValue('Pending navigation fixture');
  await page.getByRole('button', { name: '更新を保留', exact: true }).click();
  page.off('dialog', dismiss);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: '図鑑に戻る' }).click();
  await expect(page).toHaveURL(/\/zukan$/);
});

test('Next Link cannot leave during apply and works again after a failed response', async ({ page }) => {
  await openEditor(page);
  await holdEdit(page);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/update-akyo-batch', async (route) => {
    await responseGate;
    await route.fulfill({ status: 409, json: { error: 'fixture conflict' } });
  });
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => { dialogs.push(`${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); });
  try {
    await page.getByRole('button', { name: '更新を反映する', exact: true }).click();
    await expect(page.getByRole('button', { name: '反映中...', exact: true })).toBeVisible();
    // Force dispatch on an aria-disabled link to verify the guard, not just its appearance.
    await page.getByRole('link', { name: '図鑑に戻る' }).click({ force: true });
    await expect(page.getByRole('link', { name: '図鑑に戻る' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page).toHaveURL(/\/admin$/);
    expect(dialogs).toEqual([]);
  } finally {
    release();
  }
  await expect(page.getByText('fixture conflict', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '図鑑に戻る' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('保留 1件', { exact: true })).toBeVisible();
});

test('Next Link leaves without prompting when no edits are pending', async ({ page }) => {
  await openEditor(page);
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss(); });
  await page.getByRole('link', { name: '図鑑に戻る' }).click();
  await expect(page).toHaveURL(/\/zukan$/);
  expect(dialogs).toBe(0);
});
