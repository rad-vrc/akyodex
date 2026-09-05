import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

function akyo(id: string, nickname: string, category: string): AkyoData {
  const url = `https://vrchat.com/home/avatar/avtr_${id}`;
  return {
    id, nickname, avatarName: `avatar_${id}`, author: 'tester', creator: 'tester',
    category, attribute: category, comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url, avatarUrl: url,
  };
}

test('CategoriesTab bulk assignment: select categories, toggle cards, commit one batch, lock structural edits meanwhile', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const batches: PendingAkyoUpdate[][] = [];
  const pendingStates: { pending: boolean; busy: boolean }[] = [];
  const data = [
    akyo('0001', 'うまAkyo', '動物,動物/うま'),
    akyo('0002', 'ねこAkyo', '動物'),
    akyo('0003', 'くるまAkyo', '乗り物'),
  ];
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url === '/api/categories') {
        return new Response(JSON.stringify({
          success: true, head: 'h', colors: {},
          categories: [
            { path: '動物', en: 'Animal', ko: '동물', count: 2 },
            { path: '動物/うま', en: 'Animal/Horse', ko: '동물/말', count: 1 },
            { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
          ],
        }), { status: 200 });
      }
      assert.equal(url, '/api/update-akyo-batch');
      const body = JSON.parse(String(init?.body)) as PendingAkyoUpdate[];
      batches.push(body);
      const saved = body.map((update) => ({ ...data.find((entry) => entry.id === update.changes.id)!, category: update.changes.category, attribute: update.changes.category }));
      return new Response(JSON.stringify({ success: true, message: `${body.length}件の更新を反映しました`, commitUrl: 'https://github.com/x/commit/9', data: saved }), { status: 200 });
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { CategoriesTab } = await import('./tabs/categories-tab');
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
    const li = [...win.document.querySelectorAll('li')].find((entry) => entry.textContent?.includes(path === '動物' ? 'Animal |' : path))!;
    return [...li.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  };
  try {
    await act(async () =>
      root.render(createElement(CategoriesTab, {
        userRole: 'owner', akyoData: data,
        onPendingStateChange: (pending: boolean, busy: boolean) => pendingStates.push({ pending, busy }),
      })),
    );
    await flush();
    assert.equal(win.document.querySelector('section[aria-label="カテゴリの付け外し"]'), null, 'no panel until a category is selected');

    // Select 動物 and 動物/うま (AND).
    await click(listRowButton('動物', '選択'));
    await click(listRowButton('動物/うま', '選択'));
    const panel = win.document.querySelector('section[aria-label="カテゴリの付け外し"]');
    assert.ok(panel, 'panel appears');
    assert.match(panel.textContent!, /該当 1 件 \/ 全 3 件/);
    assert.equal(cardToggle('0001').article.dataset.selected, 'true');
    assert.equal(cardToggle('0002').article.dataset.selected, 'false', 'partial match is not selected');
    assert.equal(cardToggle('0003').article.dataset.selected, 'false');

    // Clicking a partial card adds the missing tokens; clicking a full card removes the set.
    await click(cardToggle('0002').toggle);
    assert.equal(cardToggle('0002').article.dataset.selected, 'true');
    assert.match(cardToggle('0002').article.textContent!, /うま/, 'the card shows the new chip before committing');
    await click(cardToggle('0001').toggle);
    assert.equal(cardToggle('0001').article.dataset.selected, 'false');
    assert.match(win.document.body.textContent!, /保留 2件/);
    assert.equal(batches.length, 0, 'nothing is written while holding');
    assert.deepEqual(pendingStates.at(-1), { pending: true, busy: false });
    assert.equal(listRowButton('動物', '改名・対訳').disabled, true, 'structural edits are locked while changes are held');
    assert.equal(listRowButton('動物', '削除').disabled, true);

    // Toggling back drops the hold for that card.
    await click(cardToggle('0001').toggle);
    assert.match(win.document.body.textContent!, /保留 1件/);
    await click(cardToggle('0001').toggle);

    await click(buttons('カテゴリの変更を反映する')[0]);
    assert.equal(batches.length, 1);
    const byId = new Map(batches[0].map((update) => [update.changes.id, update]));
    assert.equal(byId.get('0002')?.original.category, '動物');
    assert.equal(byId.get('0002')?.changes.category, '動物,動物/うま');
    assert.equal(byId.get('0001')?.original.category, '動物,動物/うま');
    assert.equal(byId.get('0001')?.changes.category, '', 'removing 動物 also removed 動物/うま');
    assert.match(win.document.body.textContent!, /2件の更新を反映しました/);
    assert.match(win.document.body.textContent!, /保留 0件/);
    assert.equal(listRowButton('動物', '改名・対訳').disabled, false, 'unlocked after the commit');
    assert.equal(cardToggle('0002').article.dataset.selected, 'true', 'saved data stays applied');
    assert.deepEqual(pendingStates.at(-1), { pending: false, busy: false });
  } finally {
    await flush();
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  }
});
