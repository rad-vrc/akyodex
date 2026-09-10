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

type Entry = { path: string; en: string | null; ko: string | null; count: number };

const DEFAULT_CATEGORIES: Entry[] = [
  { path: '動物', en: 'Animal', ko: '동물', count: 2 },
  { path: '動物/うま', en: 'Animal/Horse', ko: '동물/말', count: 1 },
  { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
  { path: '次元', en: 'Dimension', ko: '차원', count: 0 },
  { path: 'ワールド', en: 'World', ko: '월드', count: 0 },
  { path: '未翻訳', en: null, ko: null, count: 0 },
];

async function setup(options: { blockedIds?: Set<string>; categories?: Entry[] } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const batches: PendingAkyoUpdate[][] = [];
  const categoryPosts: Record<string, unknown>[] = [];
  const committed: AkyoData[][] = [];
  const pendingStates: { pending: boolean; busy: boolean; ids: string[] }[] = [];
  let listLoads = 0;
  let batchFails: string | null = null;
  const data = [
    akyo('0001', 'うまAkyo', '動物,動物/うま'),
    akyo('0002', 'ねこAkyo', '動物'),
    akyo('0003', 'くるまAkyo', '乗り物'),
  ];
  const categories = options.categories ?? DEFAULT_CATEGORIES;
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url === '/api/categories' && (init?.method ?? 'GET') === 'GET') {
        listLoads += 1;
        return new Response(JSON.stringify({ success: true, head: `h${listLoads}`, colors: {}, categories }), { status: 200 });
      }
      if (url === '/api/categories') {
        categoryPosts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ success: true, message: 'changed', commitUrl: 'https://github.com/x/commit/1', changedRows: 1 }), { status: 200 });
      }
      if (url !== '/api/update-akyo-batch') throw new Error(`unexpected request: ${url}`);
      const body = JSON.parse(String(init?.body)) as PendingAkyoUpdate[];
      batches.push(body);
      if (batchFails) return new Response(JSON.stringify({ success: false, error: batchFails }), { status: 400 });
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
  const row = (path: string) =>
    [...win.document.querySelectorAll('li')].find((entry) => entry.querySelector('.font-medium')?.textContent?.replace(/\d+ 件$/, '').trim() === path);
  const listRowButton = (path: string, text: string) => {
    const found = row(path);
    assert.ok(found, `row ${path}`);
    return [...found.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  };
  const type = async (id: string, value: string) => {
    const input = win.document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };
  await act(async () =>
    root.render(createElement(CategoriesTab, {
      userRole: 'owner', akyoData: data, blockedIds: options.blockedIds ?? new Set<string>(),
      onRowsCommitted: (rows: AkyoData[]) => committed.push(rows),
      onPendingStateChange: (pending: boolean, busy: boolean, ids: string[] = []) => pendingStates.push({ pending, busy, ids }),
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
    win, batches, categoryPosts, committed, pendingStates, buttons, click, cardToggle, row, listRowButton, type, cleanup,
    panel: () => win.document.querySelector<HTMLElement>('section[aria-label="カテゴリの付け外し"]')!,
    listLoads: () => listLoads,
    failNextBatch: (error: string) => { batchFails = error; },
  };
}

test('select, toggle, commit one batch; committed rows are handed up and the list reloads', async () => {
  const h = await setup();
  try {
    assert.equal(h.panel().hidden, true, 'hidden until a category is selected');
    assert.equal(h.listLoads(), 1);
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.listRowButton('動物/うま', '選択'));
    assert.equal(h.panel().hidden, false);
    assert.match(h.panel().textContent!, /該当 1 件 \/ 全 3 件/);
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'false', 'partial match is not selected');

    await h.click(h.cardToggle('0002').toggle);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');
    assert.equal(h.cardToggle('0002').article.dataset.pending, 'true');

    // 既に全部持つカードは「付ける」では押せない。ここが緩むと、付ける作業の途中で
    // 押し間違えたときに警告も無く外れる（2026-09-10、#0926 が対応機種/PC を失った）
    assert.equal(h.cardToggle('0001').toggle.disabled, true, '付けるモードで既に持つカードは押せない');
    assert.match(h.cardToggle('0001').article.textContent!, /変更なし/);

    // 外すのはモードを切り替えたときだけ
    await h.click(h.buttons('外す')[0]);
    assert.equal(h.cardToggle('0001').toggle.disabled, false);
    // 文言は「押すと何が起きるか」だけを言う。選択中かどうかはアイコン側の役目。
    // 混ぜると、外すモードで部分一致のカード（選択表示は付かないが押すと外れる）が
    // 「選択中（押すと外す）」になってハイライトと食い違う
    assert.match(h.cardToggle('0001').article.textContent!, /押すと外す/);
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'false');
    await h.click(h.cardToggle('0001').toggle);
    assert.match(h.win.document.body.textContent!, /保留 2件/);
    assert.equal(h.batches.length, 0, 'nothing is written while holding');
    assert.deepEqual(h.pendingStates.at(-1), { pending: true, busy: false, ids: ['0001', '0002'] });
    assert.equal(h.listRowButton('乗り物', '選択').disabled, false, 'changing the AND set stays possible while holding');

    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1);
    const byId = new Map(h.batches[0].map((update) => [update.changes.id, update]));
    assert.equal(byId.get('0002')?.changes.category, '動物,動物/うま');
    assert.equal(byId.get('0001')?.changes.category, '', 'removing 動物 also removed 動物/うま');
    assert.match(h.win.document.body.textContent!, /2件の更新を反映しました/);
    assert.equal(h.committed.length, 1, 'the saved rows leave the panel');
    assert.deepEqual(h.committed[0].map((akyoRow) => akyoRow.id).sort(), ['0001', '0002']);
    assert.equal(h.listLoads(), 2, 'the list is reloaded: main moved, so head and counts are stale');
  } finally {
    await h.cleanup();
  }
});

test('a second click on a held card reverts only that change', async () => {
  const h = await setup();
  try {
    // Row 0003 has 乗り物 only; selecting both means the first click adds 次元.
    await h.click(h.listRowButton('乗り物', '選択'));
    await h.click(h.listRowButton('次元', '選択'));
    await h.click(h.cardToggle('0003').toggle);
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'true');
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    // Undo: the row goes back to 乗り物 instead of losing it as well.
    await h.click(h.cardToggle('0003').toggle);
    assert.match(h.win.document.body.textContent!, /保留 0件/);
    assert.match(h.cardToggle('0003').article.textContent!, /乗り物/);
    assert.equal(h.cardToggle('0003').article.dataset.selected, 'false');
    assert.equal(h.batches.length, 0);
  } finally {
    await h.cleanup();
  }
});

test('cards are disabled with an empty selection and the result stays readable after a commit', async () => {
  const h = await setup();
  try {
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.cardToggle('0003').toggle);
    // Deselecting keeps the hold but must not leave clickable cards that do nothing.
    await h.click(h.listRowButton('動物', '✓ 選択中'));
    assert.equal(h.panel().hidden, false, 'held changes keep the panel open with an empty set');
    assert.equal(h.cardToggle('0003').toggle.disabled, false, 'a held card can still be reverted');
    assert.equal(h.cardToggle('0001').toggle.disabled, true, 'without a selection there is nothing to toggle');
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1);
    assert.equal(h.panel().hidden, false, 'the success message is not hidden with the panel');
    assert.match(h.panel().textContent!, /1件の更新を反映しました/);
  } finally {
    await h.cleanup();
  }
});

test('protected categories cannot be selected for assignment', async () => {
  const h = await setup();
  try {
    assert.equal(h.listRowButton('動物', '選択') !== undefined, true);
    assert.equal([...h.row('ワールド')!.querySelectorAll('button')].some((b) => b.textContent?.trim() === '選択'), false);
    assert.match(h.row('ワールド')!.textContent!, /自動付与/);
  } finally {
    await h.cleanup();
  }
});

test('rows held by the edit tab are refused, and a rejected commit keeps the hold', async () => {
  const h = await setup({ blockedIds: new Set(['0002']) });
  try {
    await h.click(h.listRowButton('動物/うま', '選択'));
    await h.click(h.cardToggle('0002').toggle);
    assert.match(h.panel().textContent!, /#0002 は編集・削除タブで保留中です/);
    assert.match(h.win.document.body.textContent!, /保留 0件/);

    h.failNextBatch('存在しないカテゴリが含まれています: 動物/うま。ページを再読み込みしてください');
    // 0001 は既に動物/うまを持つので、外すモードでだけ押せる
    await h.click(h.buttons('外す')[0]);
    await h.click(h.cardToggle('0001').toggle);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1);
    assert.match(h.panel().textContent!, /存在しないカテゴリが含まれています/);
    assert.match(h.win.document.body.textContent!, /保留 1件/, 'the hold survives a rejected commit');
    assert.equal(h.committed.length, 0);
  } finally {
    await h.cleanup();
  }
});

test('translations stay editable while assignments are held; renaming and deleting do not', async () => {
  const h = await setup();
  try {
    await h.click(h.listRowButton('動物', '選択'));
    await h.click(h.cardToggle('0003').toggle);
    assert.match(h.win.document.body.textContent!, /保留 1件/);
    assert.equal(h.listRowButton('動物', '統合').disabled, true);
    assert.equal(h.listRowButton('動物', '削除').disabled, true);
    assert.equal(h.listRowButton('未翻訳', '対訳を登録').disabled, false, 'a translation changes no Akyo row');

    await h.click(h.listRowButton('未翻訳', '対訳を登録'));
    await h.type('category-editor-rename-en', 'Untranslated');
    await h.type('category-editor-rename-ko', '미번역');
    await h.click(h.buttons('決定')[0]);
    assert.deepEqual(h.categoryPosts.at(-1), { action: 'translate', path: '未翻訳', en: 'Untranslated', ko: '미번역', head: 'h1' });

    // Renaming the same category would rewrite tokens on the held rows: refused.
    await h.click(h.listRowButton('動物', '改名・対訳'));
    await h.type('category-editor-rename-ja', '生物');
    const submit = h.buttons('決定')[0];
    assert.equal(submit.disabled, true);
    await act(async () => submit.click());
    assert.equal(h.categoryPosts.filter((post) => post.action === 'rename').length, 0);
  } finally {
    await h.cleanup();
  }
});
