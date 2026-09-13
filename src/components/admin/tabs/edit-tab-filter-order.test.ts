import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { AkyoData } from '@/types/akyo';

/**
 * 編集タブの絞り込み一覧も、カテゴリ選択モーダルと同じく対応機種とその配下を先頭に固定する
 * （compareCategories）。共通の一覧（attributes）のあとに、カタログにしか無いカテゴリを
 * 継ぎ足しているので、継ぎ足した後で並べないと継ぎ足した分が末尾に残る。
 * 親の「対応機種」単体は、図鑑の絞り込みと違って管理画面では隠さない。
 */
test('編集タブの絞り込み: 対応機種とその配下が先頭で、親も隠さず、残りは文字コード順', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    // 並びを見るだけなので通信は起きないはず。起きたら気付けるように落とす
    fetch: async (url: string) => { throw new Error(`unexpected request: ${url}`); },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { EditTab } = await import('./edit-tab');
  const root = createRoot(win.document.getElementById('root')!);
  const url = (id: string) => `https://vrchat.com/home/avatar/avtr_${id}`;
  const akyo = (id: string, category: string): AkyoData => ({
    id, nickname: `Akyo ${id}`, avatarName: 'Akyo', author: 'Author', creator: 'Author',
    category, attribute: category, comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url(id), avatarUrl: url(id),
  });
  // AdminTabs から来る共通の一覧は素の .sort() の順。「あお」はカタログにしか無く、後ろに継ぎ足される
  const attributes = ['Booth', '動物', '対応機種', '対応機種/PC', '対応機種/Quest(Android)'];
  const data = [
    akyo('0001', '動物,対応機種,対応機種/PC'),
    akyo('0002', 'あお,対応機種,対応機種/Quest(Android)'),
    akyo('0003', 'Booth'),
  ];
  const known = ['Booth', 'あお', '動物', '対応機種', '対応機種/PC', '対応機種/Quest(Android)'];
  // ボタンに件数などが付いても読めるよう、既知の名前のうち先頭から一致するいちばん長いものを取る
  const labelOf = (text: string) =>
    known.filter((name) => text.startsWith(name)).sort((a, b) => b.length - a.length)[0];
  try {
    await act(async () =>
      root.render(createElement(EditTab, { userRole: 'owner', akyoData: data, attributes, onDataChange: () => {} })),
    );
    const toggle = [...win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '絞り込みを開く');
    assert.ok(toggle, '「絞り込みを開く」がある');
    await act(async () => toggle.click());
    const panel = win.document.getElementById('admin-edit-filter-panel');
    assert.ok(panel, '絞り込みパネルがある');
    const labels = [...panel.querySelectorAll('[role="option"]')]
      .map((option) => labelOf(option.textContent?.trim() ?? ''))
      .filter((label): label is string => label !== undefined);
    assert.deepEqual(labels, [
      '対応機種', '対応機種/PC', '対応機種/Quest(Android)',
      'Booth', 'あお', '動物',
    ]);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  }
});
