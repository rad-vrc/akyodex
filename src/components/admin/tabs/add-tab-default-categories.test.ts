import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

/**
 * 新規登録の画面に入った時点で、カテゴリ欄に「対応機種」と「対応機種/PC」が入っていること。
 *
 * ほぼすべての Akyo が持つので毎回手で選ばせない、というだけの初期値。保存内容の保証では
 * ないので、送信時に足す処理は入れていない（外して登録すればそのまま外れる）。
 * ここが空に戻ると、登録のたびに手で付け直すことになる。
 */

const DEFAULT_CATEGORIES = ['対応機種', '対応機種/PC'];

async function mount(draft?: unknown) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/admin',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };

  const { ADD_TAB_DRAFT_KEY } = await import('../draft-keys');
  if (draft !== undefined) win.sessionStorage.setItem(ADD_TAB_DRAFT_KEY, JSON.stringify(draft));

  // Node 21+ の globalThis.navigator は getter 専用なので defineProperty で差し替える
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    navigator: win.navigator,
    sessionStorage: win.sessionStorage,
    localStorage: win.localStorage,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    alert: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) =>
      new Response(JSON.stringify(String(url).includes('next-id') ? { nextId: '0953' } : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  })) expose(key, value);

  // DOM を用意してから読む。react-dom/client は初期化時に DOM の有無を見る
  const { createRoot } = await import('react-dom/client');
  const { AddTab } = await import('./add-tab');
  const root = createRoot(win.document.getElementById('root')!);
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => {
    root.render(createElement(AddTab, { userRole: 'owner' as const, attributes: [], creators: [] }));
  });
  await flush();

  /** 「選択されたカテゴリ」欄に出ているチップの文字 */
  const chips = () =>
    [...win.document.querySelectorAll('span.rounded-full')]
      .map((chip) => chip.textContent?.trim() ?? '')
      .filter(Boolean);

  const cleanup = async () => {
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  };
  return { win, chips, cleanup };
}

test('新規登録の画面は、カテゴリ欄に対応機種と対応機種/PC が入った状態で開く', async () => {
  const screen = await mount();
  try {
    for (const category of DEFAULT_CATEGORIES) {
      assert.ok(screen.chips().includes(category), `${category} が初期値に無い（${screen.chips().join(' / ')}）`);
    }
    // 空欄の案内文が出ていない＝初期値が実際に入っている
    assert.doesNotMatch(screen.win.document.body.textContent ?? '', /選択されたカテゴリがここに表示されます/);
  } finally {
    await screen.cleanup();
  }
});

// 初期値であって強制ではない。外した状態は下書きに残り、開き直しても戻らない
test('下書きでカテゴリを外していたら、その状態のまま開く', async () => {
  const screen = await mount({ nickname: '', categories: [], customCategories: [] });
  try {
    assert.deepEqual(screen.chips(), []);
    assert.match(screen.win.document.body.textContent ?? '', /選択されたカテゴリがここに表示されます/);
  } finally {
    await screen.cleanup();
  }
});

test('下書きに別のカテゴリが入っていたら、初期値を混ぜずにそれだけを出す', async () => {
  const screen = await mount({ nickname: '', categories: ['動物'], customCategories: [] });
  try {
    assert.deepEqual(screen.chips(), ['動物']);
  } finally {
    await screen.cleanup();
  }
});
