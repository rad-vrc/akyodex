import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { AkyoData } from '@/types/akyo';

// 親（AdminTabs）が新しい akyoData を渡したとき、保留中の行は新しい一覧から消えていても残す。
// 取り込みの副作用は pendingRef から保留を読むので、ref が最新の保留を指していないと行が消える
test('a new akyoData prop keeps pending rows that it no longer carries', async () => {
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
    fetch: async (url: string) => {
      throw new Error(`unexpected request: ${url}`);
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { EditTab } = await import('./edit-tab');
  const root = createRoot(win.document.getElementById('root')!);
  const sourceUrl = 'https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc';
  const data: AkyoData[] = ['0001', '0002', '0003'].map((id) => ({
    id, nickname: `Original ${id}`, avatarName: 'Akyo', author: 'Author', creator: 'Author',
    category: '動物', attribute: '動物', comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl, avatarUrl: sourceUrl,
  }));
  const rowFor = (id: string) => [...win.document.querySelectorAll('tbody tr')]
    .find((row) => row.children[1]?.textContent === `#${id}`);
  const render = (akyoData: AkyoData[]) =>
    act(async () => root.render(createElement(EditTab, { userRole: 'owner', akyoData, attributes: ['動物'], onDataChange: () => {} })));
  try {
    await render(data);
    await act(async () => {
      rowFor('0002')!.querySelector('button')!.click();
    });
    const input = win.document.querySelector<HTMLInputElement>('#edit-nickname')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Held edit');
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await act(async () => {
      win.document.querySelector('form')!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.match(win.document.body.textContent!, /保留 1件/);

    // 0002（保留あり）と 0003（保留なし）が新しい一覧から消えた
    await render([data[0]]);
    assert.ok(rowFor('0002'), 'a pending row must stay even when the new catalog no longer carries it');
    assert.match(rowFor('0002')!.textContent!, /Held edit/);
    assert.equal(rowFor('0003'), undefined, 'a row without pending changes follows the new catalog');
    assert.match(win.document.body.textContent!, /保留 1件/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
