import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { applyAkyoEditFields, type PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import type { AkyoData } from '@/types/akyo';

test('hold/re-edit/cancel, failed apply, retry and repeated apply preserve the batch contract', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const requests: PendingAkyoUpdate[][] = [];
  let resolveRequest: (response: Response) => void = () => {};
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: () => true, alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, '/api/update-akyo-batch', 'holding must never call the single-update API');
      requests.push(JSON.parse(String(init.body)));
      return new Promise<Response>((resolve) => { resolveRequest = resolve; });
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { EditTab } = await import('./edit-tab');
  const root = createRoot(win.document.getElementById('root')!);
  const sourceUrl = 'https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc';
  const data: AkyoData[] = ['0001', '0002'].map((id) => ({
    id, nickname: `Original ${id}`, avatarName: 'Akyo', author: 'Author', creator: 'Author',
    category: '動物', attribute: '動物', comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl, avatarUrl: sourceUrl,
  }));
  const button = (text: string) => [...win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  const edit = async (index: number, value: string) => {
    await act(async () => {
      [...win.document.querySelectorAll('tbody tr')][index].querySelector('button')!.click();
    });
    const input = win.document.querySelector<HTMLInputElement>('#edit-nickname')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await act(async () => {
      win.document.querySelector('form')!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    });
  };
  try {
    await act(async () => root.render(createElement(EditTab, { userRole: 'owner', akyoData: data, attributes: ['動物'], onDataChange: () => {} })));
    assert.equal(button('更新を反映する').disabled, true);
    await edit(0, 'First edit');
    await edit(0, 'Second edit');
    await edit(1, 'Other edit');
    assert.equal(requests.length, 0, 'holding makes no write requests');
    assert.match(win.document.body.textContent!, /保留 2件/);
    await act(async () => win.document.querySelector<HTMLButtonElement>('[aria-label="#0002 の保留を取り消す"]')!.click());
    assert.match(win.document.body.textContent!, /保留 1件/);
    await edit(1, 'Other edit');
    await act(async () => { button('更新を反映する').click(); button('更新を反映する').click(); });
    assert.equal(requests.length, 1, 'double click sends one request');
    assert.equal(requests[0].length, 2);
    assert.equal(requests[0][0].original.nickname, 'Original 0001');
    assert.equal(requests[0][0].changes.nickname, 'Second edit');
    await act(async () => resolveRequest(Response.json({ success: false, error: 'test conflict' }, { status: 409 })));
    assert.match(win.document.body.textContent!, /保留 2件/);
    assert.match(win.document.body.textContent!, /test conflict/);
    await act(async () => button('更新を反映する').click());
    assert.equal(requests.length, 2);
    const saved = requests[1].map((entry, index) => applyAkyoEditFields(data[index], entry.changes));
    await act(async () => resolveRequest(Response.json({ success: true, message: '2件の更新を反映しました', data: saved })));
    assert.match(win.document.body.textContent!, /保留 0件/);
    assert.equal(button('更新を反映する').disabled, true);
    await edit(0, 'Third edit');
    await act(async () => button('更新を反映する').click());
    assert.equal(requests[2][0].original.nickname, 'Second edit', 'next batch uses committed data, not stale initial props');
    await act(async () => resolveRequest(Response.json({ success: true, message: 'ok', data: [applyAkyoEditFields(saved[0], requests[2][0].changes)] })));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
