import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

/**
 * The two admin tabs write to the same Akyo rows through the same batch API. These cases drive
 * the real AdminTabs so a committed row cannot be lost between the tabs, by a refresh, or by a
 * category rename.
 *
 * 再取得は `/api/admin/catalog`（保存先の CSV スナップショット）を読む。公開カタログと違って
 * 遅れないので「行が無い＝その head には存在しない」と読める。ただし言えるのは読んだ head の
 * 時点までで、取得中に保存が通れば正しい CSV でもこちらより古い。そこは AdminTabs が持つ
 * `catalogSync` が保存の回数で見分けて捨てる。**この配線はここでしか通らない**（EditTab 単体の
 * テストは catalogSync を渡さないので、渡ってきたときの分岐が動かない）。
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
  let refreshCalls = 0;
  // 取得を握ったまま保存を通せるようにする。取得中に保存が入ったときの分岐は、応答が
  // 戻る前に保存が通らないと踏めない
  let holdRefresh = false;
  let release: (() => void) | null = null;
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    sessionStorage: win.sessionStorage, localStorage: win.localStorage,
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/catalog')) {
        refreshCalls += 1;
        if (holdRefresh) await new Promise<void>((resolve) => { release = resolve; });
        return Response.json({ success: true, head: 'a'.repeat(40), count: refreshRows.length, data: refreshRows });
      }
      if (url === '/api/admin/next-id') return Response.json({ success: true, nextId: '0003' });
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
  const refreshButton = () => win.document.querySelector<HTMLButtonElement>('[aria-label="最新データを再取得"]')!;
  const typeInto = async (id: string, value: string) => {
    const input = win.document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };
  await act(async () =>
    root.render(createElement(AdminTabs, {
      userRole: 'owner', attributes: ['動物'], creators: ['tester'], akyoData: initial,
    })),
  );
  await flush();
  return {
    win, batches, buttons, click, cardToggle, listRowButton, flush, refreshButton, typeInto,
    initial,
    refreshCalls: () => refreshCalls,
    setCategories: (next: typeof categories) => { categories = next; },
    setRenameResponse: (next: Record<string, unknown>) => { renameResponse = next; },
    setRefreshRows: (rows: AkyoData[]) => { refreshRows = rows; },
    holdRefresh: () => { holdRefresh = true; },
    cleanup: async () => {
      await flush();
      await act(async () => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      win.close();
    },
    releaseRefresh: async () => {
      assert.ok(release, '取得が止まっていること');
      await act(async () => {
        release!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await flush();
    },
  };
}

test('a category commit reaches the edit tab, survives a refresh, and follows a rename', async () => {
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

    // 再取得は保存先の CSV を読む。保存が通っているので、返るスナップショットにも入っている
    h.setRefreshRows([akyo('0001', 'うまAkyo', '動物'), akyo('0002', 'ねこAkyo', '動物,乗り物')]);
    await h.click(h.refreshButton());
    assert.equal(h.refreshCalls(), 1, '公開カタログではなく管理用 API を読む');
    assert.match(h.win.document.body.textContent!, /データを再取得しました/);
    await h.click(h.buttons('カテゴリ')[0]);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true', 'a refresh must not undo the commit');

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
    await h.typeInto('category-editor-rename-ja', '生物');
    await h.click(h.buttons('決定')[0]);
    await h.click(h.listRowButton('乗り物', '✓ 選択中'));
    await h.click(h.listRowButton('生物', '選択'));
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true', 'the renamed category is on the cards');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');

    // 改名も CSV に書かれているので、そのあとの再取得にも入っている
    h.setRefreshRows([akyo('0001', 'うまAkyo', '生物'), akyo('0002', 'ねこAkyo', '生物,乗り物')]);
    await h.click(h.buttons('編集・削除')[0]);
    await h.click(h.refreshButton());
    assert.equal(h.refreshCalls(), 2);
    await h.click(h.buttons('カテゴリ')[0]);
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true', 'a refresh must not undo the rename');
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true');
  } finally {
    await h.cleanup();
  }
});

/*
 * 取得を始めたあとに保存が通ったら、返ってきたスナップショットは正しい CSV でもこちらより
 * 古い。採用すると、保存したばかりの内容が画面上で巻き戻る（このタブの `catalogSync` の
 * 配線を外しても、lib のテストは全部通ってしまう）。保存の入口は 2 つあり、どちらも印を
 * 進めないと同じことが起きるので、両方を踏む。
 */
test('取得中に「まとめて付ける」の保存が通ったら、その取得結果は使わない', async () => {
  const h = await setup();
  try {
    // 編集タブで再取得を始め、応答を握ったままにする（カテゴリタブは先に開いて載せておく）
    await h.click(h.buttons('カテゴリ')[0]);
    await h.click(h.buttons('編集・削除')[0]);
    h.holdRefresh();
    await h.click(h.refreshButton());
    assert.equal(h.refreshCalls(), 1, '取得は始まっている');

    // その間にカテゴリタブで保存を通す
    await h.click(h.buttons('カテゴリ')[0]);
    await h.click(h.listRowButton('乗り物', '選択'));
    await h.click(h.cardToggle('0002').toggle);
    await h.click(h.buttons('カテゴリの変更を反映する')[0]);
    assert.equal(h.batches.length, 1, '保存は通っている');

    // 取得は保存より前の CSV を読んでいた
    h.setRefreshRows(h.initial);
    await h.releaseRefresh();

    await h.click(h.buttons('編集・削除')[0]);
    assert.match(
      h.win.document.body.textContent!,
      /取得中に保存が入ったため、取得結果は使いませんでした/,
      '古い取得結果は捨てて、そう言う',
    );
    assert.doesNotMatch(h.win.document.body.textContent!, /データを再取得しました/);
    await h.click(h.buttons('カテゴリ')[0]);
    assert.equal(h.cardToggle('0002').article.dataset.selected, 'true', '保存した内容が巻き戻らない');
  } finally {
    await h.cleanup();
  }
});

test('取得中に改名が通ったら、その取得結果は使わない', async () => {
  const h = await setup();
  try {
    await h.click(h.buttons('カテゴリ')[0]);
    await h.click(h.buttons('編集・削除')[0]);
    h.holdRefresh();
    await h.click(h.refreshButton());
    assert.equal(h.refreshCalls(), 1);

    // 改名は行を書き換えるので、保存と同じく取得より新しい
    await h.click(h.buttons('カテゴリ')[0]);
    h.setRenameResponse({
      success: true, message: 'renamed', changedRows: 2,
      updatedRows: [{ id: '0001', category: '生物' }, { id: '0002', category: '生物' }],
    });
    h.setCategories([
      { path: '生物', en: 'Creature', ko: '생물', count: 2 },
      { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 0 },
    ]);
    await h.click(h.listRowButton('動物', '改名・対訳'));
    await h.typeInto('category-editor-rename-ja', '生物');
    await h.click(h.buttons('決定')[0]);

    h.setRefreshRows(h.initial);
    await h.releaseRefresh();

    await h.click(h.buttons('編集・削除')[0]);
    assert.match(
      h.win.document.body.textContent!,
      /取得中に保存が入ったため、取得結果は使いませんでした/,
      '改名も印を進めること',
    );
    await h.click(h.buttons('カテゴリ')[0]);
    await h.click(h.listRowButton('生物', '選択'));
    assert.equal(h.cardToggle('0001').article.dataset.selected, 'true', '改名が巻き戻らない');
  } finally {
    await h.cleanup();
  }
});
