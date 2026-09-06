import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

/**
 * The two admin tabs write to the same Akyo rows through the same batch API, and the public
 * JSON they can refresh from lags behind those writes. These cases drive the real AdminTabs so
 * a committed row cannot be lost between the tabs, by a stale refresh, or by a category rename.
 */

function akyo(id: string, nickname: string, category: string): AkyoData {
  const url = `https://vrchat.com/home/avatar/avtr_${id}`;
  return {
    id, nickname, avatarName: `avatar_${id}`, author: 'tester', creator: 'tester',
    category, attribute: category, comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url, avatarUrl: url,
  };
}

async function setup() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const initial = [akyo('0001', 'うまAkyo', '動物'), akyo('0002', 'ねこAkyo', '動物')];
  let categories = [
    { path: '動物', en: 'Animal', ko: '동물', count: 2 },
    { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 0 },
  ];
  let renameResponse: Record<string, unknown> | null = null;
  const batches: PendingAkyoUpdate[][] = [];
  let refreshRows: AkyoData[] = initial;
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    sessionStorage: win.sessionStorage, localStorage: win.localStorage,
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/catalog/ja?refresh=')) {
        return Response.json({ schemaVersion: 1, language: 'ja', revision: 'c'.repeat(64), count: refreshRows.length, data: refreshRows });
      }
      if (url === '/api/categories' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ success: true, head: 'h', colors: {}, categories }), { status: 200 });
      }
      if (url === '/api/categories') {
        return new Response(JSON.stringify(renameResponse ?? { success: true, message: 'changed', changedRows: 0 }), { status: 200 });
      }
      if (url !== '/api/update-akyo-batch') throw new Error(`unexpected request: ${url}`);
      const body = JSON.parse(String(init?.body)) as PendingAkyoUpdate[];
      batches.push(body);
      const saved = body.map((update) => ({
        ...initial.find((entry) => entry.id === update.changes.id)!,
        category: update.changes.category, attribute: update.changes.category,
      }));
      return new Response(JSON.stringify({ success: true, message: `${body.length}件の更新を反映しました`, data: saved }), { status: 200 });
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { AdminTabs } = await import('./admin-tabs');
  const root = createRoot(win.document.getElementById('root')!);
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const buttons = (text: string) => [...win.document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text);
  const click = async (button: HTMLButtonElement | undefined) => {
    assert.ok(button, 'button exists');
    await act(async () => button.click());
    await flush();
  };
  const cardToggle = (id: string) => {
    const article = win.document.getElementById(`card-title-${id}`)?.closest('article') as HTMLElement | null;
    assert.ok(article, `card ${id}`);
    return { article, toggle: article.querySelector<HTMLButtonElement>('button[aria-pressed]')! };
  };
  const listRowButton = (path: string, text: string) => {
    const li = [...win.document.querySelectorAll('li')].find((entry) => entry.querySelector('.font-medium')?.textContent?.replace(/\d+ 件$/, '').trim() === path);
    assert.ok(li, `row ${path}`);
    return [...li.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  };
  await act(async () =>
    root.render(createElement(AdminTabs, {
      userRole: 'owner', attributes: ['動物'], creators: ['tester'], akyoData: initial,
    })),
  );
  await flush();
  return {
    win, batches, buttons, click, cardToggle, listRowButton, flush,
    setCategories: (next: typeof categories) => { categories = next; },
    setRenameResponse: (next: Record<string, unknown>) => { renameResponse = next; },
    setRefreshRows: (rows: AkyoData[]) => { refreshRows = rows; },
    cleanup: async () => {
      await flush();
      await act(async () => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      win.close();
    },
  };
}

test('a category commit reaches the edit tab, survives a stale refresh, and follows a rename', async () => {
  const h = await setup();
  try {
    await h.click(h.buttons('カテゴリ')[0]);
    await h.click(h.listRowButton('乗り物', '選択'));
    await h.click(h.cardToggle('0002').toggle);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');

    // The edit tab is fed by the same catalog, so it sees the new category immediately.
    await h.click(h.buttons('編集・削除')[0]);
    await h.click(h.buttons('絞り込みを開く')[0]);
    assert.match(h.win.document.getElementById('admin-edit-filter-panel')!.textContent!, /乗り物/);

    // Refreshing reads the public JSON, which has not been regenerated yet: our commit stands.
    await h.click(h.win.document.querySelector<HTMLButtonElement>('[aria-label="最新データを再取得"]')!);
    await h.click(h.buttons('カテゴリ')[0]);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true', 'a lagging refresh must not undo the commit');

    // Renaming rewrites the CSV rows; the cards follow without waiting for the JSON sync.
    h.setRenameResponse({
      success: true, message: 'renamed', changedRows: 2,
      updatedRows: [{ id: '0001', category: '生物' }, { id: '0002', category: '生物,乗り物' }],
    });
    h.setCategories([
      { path: '生物', en: 'Creature', ko: '생물', count: 2 },
      { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
    ]);
    await h.click(h.listRowButton('動物', '改名・対訳'));
    const ja = h.win.document.getElementById('category-editor-rename-ja') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.win.HTMLInputElement.prototype, 'value')!.set!.call(ja, '生物');
      ja.dispatchEvent(new h.win.Event('input', { bubbles: true }));
    });
    await h.click(h.buttons('決定')[0]);
    await h.click(h.listRowButton('乗り物', '✓ 選択中'));
    await h.click(h.listRowButton('生物', '選択'));
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true', 'the renamed category is on the cards');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');

    // The rename is recorded like a commit, so the pre-rename JSON must not undo it either —
    // for the row this session had already saved and for the one it had never touched.
    await h.click(h.buttons('編集・削除')[0]);
    await h.click(h.win.document.querySelector<HTMLButtonElement>('[aria-label="最新データを再取得"]')!);
    await h.click(h.buttons('カテゴリ')[0]);
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true', 'a lagging refresh must not undo the rename');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');
  } finally {
    await h.cleanup();
  }
});
