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

type Entry = { path: string; en: string; ko: string; count: number };

async function setup() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const batches: PendingAkyoUpdate[][] = [];
  const categoryPosts: Record<string, unknown>[] = [];
  const pendingStates: { pending: boolean; busy: boolean }[] = [];
  const data = [
    akyo('0001', 'うまAkyo', '動物,動物/うま'),
    akyo('0002', 'ねこAkyo', '動物'),
    akyo('0003', 'くるまAkyo', '乗り物'),
  ];
  let categories: Entry[] = [
    { path: '動物', en: 'Animal', ko: '동물', count: 2 },
    { path: '動物/うま', en: 'Animal/Horse', ko: '동물/말', count: 1 },
    { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
    { path: '次元', en: 'Dimension', ko: '차원', count: 0 },
  ];
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url === '/api/categories' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ success: true, head: 'h', colors: {}, categories }), { status: 200 });
      }
      if (url === '/api/categories') {
        categoryPosts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ success: true, message: 'changed', commitUrl: 'https://github.com/x/commit/1', changedRows: 1 }), { status: 200 });
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
    const li = [...win.document.querySelectorAll('li')].find((entry) => entry.querySelector('.font-medium')?.textContent?.replace(/\d+ 件$/, '').trim() === path)!;
    assert.ok(li, `row ${path}`);
    return [...li.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  };
  const panel = () => win.document.querySelector<HTMLElement>('section[aria-label="カテゴリの付け外し"]')!;
  const type = async (id: string, value: string) => {
    const input = win.document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };
  await act(async () =>
    root.render(createElement(CategoriesTab, {
      userRole: 'owner', akyoData: data,
      onPendingStateChange: (pending: boolean, busy: boolean) => pendingStates.push({ pending, busy }),
    })),
  );
  await flush();
  const cleanup = async () => {
    await flush();
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  };
  return {
    win, batches, categoryPosts, pendingStates, buttons, click, cardToggle, listRowButton, panel, type, cleanup,
    setCategories: (next: Entry[]) => { categories = next; },
  };
}

test('select categories, toggle cards, commit one batch; structural edits are locked while holding', async () => {
  const h = await setup();
  try {
    assert.equal(h.panel().hidden, true, 'panel hidden until a category is selected');
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.listRowButton('動物/うま', '選択'));
    assert.equal(h.panel().hidden, false);
    assert.match(h.panel().textContent!, /該当 1 件 \/ 全 3 件/);
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'false', 'partial match is not selected');

    await h.click(h.cardToggle('0002').toggle);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');
    assert.match(h.cardToggle('0002').article.textContent!, /うま/, 'the card shows the new chip before committing');
    await h.click(h.cardToggle('0001').toggle);
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'false');
    assert.match(h.win.document.body.textContent!, /保留 2件/);
    assert.equal(h.batches.length, 0, 'nothing is written while holding');
    assert.deepEqual(h.pendingStates.at(-1), { pending: true, busy: false });
    assert.equal(h.listRowButton('動物', '改名・対訳').disabled, true, 'structural edits are locked while changes are held');
    assert.equal(h.listRowButton('動物', '削除').disabled, true);
    assert.equal(h.listRowButton('乗り物', '選択').disabled, false, 'changing the AND set stays possible');

    await h.click(h.cardToggle('0001').toggle);
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    await h.click(h.cardToggle('0001').toggle);

    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1);
    const byId = new Map(h.batches[0].map((update) => [update.changes.id, update]));
    assert.equal(byId.get('0002')?.changes.category, '動物,動物/うま');
    assert.equal(byId.get('0001')?.changes.category, '', 'removing 動物 also removed 動物/うま');
    assert.match(h.win.document.body.textContent!, /2件の更新を反映しました/);
    assert.equal(h.listRowButton('動物', '改名・対訳').disabled, false, 'unlocked after the commit');
    assert.deepEqual(h.pendingStates.at(-1), { pending: false, busy: false });

    // Saved results survive clearing and re-selecting (the panel stays mounted).
    await h.click(h.buttons('選択を解除')[0]);
    assert.equal(h.panel().hidden, true);
    await h.click(h.listRowButton('動物/うま', '選択'));
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true', 'the saved assignment is still shown');
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'false');
    await h.click(h.cardToggle('0002').toggle);
    assert.equal(h.batches.length, 1);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches[1][0].original.category, '動物,動物/うま', 'the next hold starts from the saved row, not the stale catalog');
  } finally {
    await h.cleanup();
  }
});

test('two selected then one deselected: the second click removes only the remaining category; an empty set keeps the hold', async () => {
  const h = await setup();
  try {
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.listRowButton('次元', '選択'));
    await h.click(h.cardToggle('0003').toggle);
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'true');
    await h.click(h.listRowButton('次元', '✓ 選択中'));
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'true', 'still carries 動物');
    await h.click(h.cardToggle('0003').toggle);
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'false');
    assert.match(h.cardToggle('0003').article.textContent!, /次元/, '次元 stays, 動物 was removed');
    await h.click(h.listRowButton('動物', '✓ 選択中'));
    assert.equal(h.panel().hidden, false, 'held changes keep the panel open with an empty set');
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches[0][0].changes.category, '乗り物,次元');
  } finally {
    await h.cleanup();
  }
});

test('a rename drops the old name from the AND set and a commit refuses categories that no longer exist', async () => {
  const h = await setup();
  try {
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.cardToggle('0003').toggle);
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    // Another admin renames 動物 → 生物 on main.
    h.setCategories([
      { path: '生物', en: 'Creature', ko: '생물', count: 2 },
      { path: '生物/うま', en: 'Creature/Horse', ko: '생물/말', count: 1 },
      { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
      { path: '次元', en: 'Dimension', ko: '차원', count: 0 },
    ]);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 0, 'the old name must not be written back');
    assert.match(h.win.document.body.textContent!, /存在しなくなったカテゴリがあります: 動物/);
    assert.equal(h.win.document.querySelectorAll('.font-medium').length > 0 && !h.win.document.body.textContent!.includes('✓ 選択中'), true, 'the stale selection is gone after the reload');
    assert.match(h.win.document.body.textContent!, /保留 1件/, 'the hold is kept for the admin to cancel');
    await h.click(h.buttons('すべて取り消す')[0]);
    assert.match(h.win.document.body.textContent!, /保留 0件/);
    // With nothing selected a card click is a no-op.
    await h.click(h.listRowButton('生物', '選択'));
    await h.click(h.listRowButton('生物', '✓ 選択中'));
    assert.equal(h.panel().hidden, true);
  } finally {
    await h.cleanup();
  }
});

test('a rename form opened before the hold cannot be submitted while changes are held', async () => {
  const h = await setup();
  try {
    await h.click(h.listRowButton('動物', '改名・対訳'));
    await h.type('category-editor-rename-ja', '生物');
    await h.click(h.listRowButton('乗り物', '選択'));
    await h.click(h.cardToggle('0002').toggle);
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    const submit = h.buttons('決定')[0];
    assert.equal(submit.disabled, true, 'the open form is locked too');
    assert.match(submit.title, /保留中のカテゴリ変更を反映または取り消してから/);
    await act(async () => submit.click());
    await h.click(h.listRowButton('動物', '削除'));
    assert.equal(h.categoryPosts.length, 0, 'no structural change while holding');
    // Unlocked again once the hold is gone.
    await h.click(h.buttons('すべて取り消す')[0]);
    assert.equal(h.buttons('決定')[0].disabled, false);
  } finally {
    await h.cleanup();
  }
});
