import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

/**
 * カテゴリの行は「持つトークンの祖先を全部並べる」形をしている（data/akyo-data-ja.csv の
 * 948 件すべて）。モーダルは 1 段ずつしか足さなかったので、`色/紫色系` を選んでも `色` は
 * 付かず、押し忘れると親の抜けた行が保存できてしまった。選ぶときは親を補い、親を外すときは
 * 配下も外す。新規作成の直後も同じで、既にある親は作られないぶん選び漏れやすい。
 */
test('AttributeModal: 子を選ぶと親も選ばれ、親を外すと配下も外れる', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node, KeyboardEvent: win.KeyboardEvent,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { AttributeModal } = await import('./attribute-modal');
  const root = createRoot(win.document.getElementById('root')!);
  const applied: string[][] = [];
  try {
    await act(async () =>
      root.render(createElement(AttributeModal, {
        isOpen: true,
        onClose: () => {},
        currentAttributes: [],
        onApply: (next: string[]) => applied.push(next),
        allAttributes: ['動物', '色', '色/紫色系', '色/紫色系/薄紫'],
      })),
    );
    const button = (text: string) =>
      [...win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
    const click = async (text: string) => {
      const target = button(text);
      assert.ok(target, `「${text}」のボタンが無い`);
      await act(async () => target.click());
    };

    // 子を 1 回押すだけで、その上の階層まで揃う
    await click('色/紫色系');
    await click('選択を決定');
    assert.deepEqual(applied.at(-1), ['色', '色/紫色系']);

    // 既に選んである親は二重に入れず、押していない選択の並びも動かさない
    await click('動物');
    await click('色/紫色系/薄紫');
    await click('選択を決定');
    assert.deepEqual(applied.at(-1), ['色', '色/紫色系', '動物', '色/紫色系/薄紫']);

    // 親を外したら配下も外す。残すと親の無い子だけが行に残る
    await click('色');
    await click('選択を決定');
    assert.deepEqual(applied.at(-1), ['動物']);

    // 子だけを外すのは親に影響しない
    await click('色/紫色系');
    await click('色/紫色系');
    await click('選択を決定');
    assert.deepEqual(applied.at(-1), ['動物', '色']);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  }
});

test('AttributeModal: 作った直後は、既にある親も一緒に選ばれている', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node, KeyboardEvent: win.KeyboardEvent,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      assert.equal(url, '/api/categories');
      const body = JSON.parse(String(init?.body)) as { path: string; ancestors?: { path: string }[] };
      // 既にある親は作られないので、応答にも出てこない
      const createdPaths = [...(body.ancestors ?? []).map((entry) => entry.path), body.path];
      return new Response(JSON.stringify({ success: true, createdPaths }), { status: 200 });
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { AttributeModal } = await import('./attribute-modal');
  const root = createRoot(win.document.getElementById('root')!);
  const applied: string[][] = [];
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  try {
    await act(async () =>
      root.render(createElement(AttributeModal, {
        isOpen: true,
        onClose: () => {},
        currentAttributes: [],
        onApply: (next: string[]) => applied.push(next),
        allAttributes: ['色'],
      })),
    );
    const button = (text: string) =>
      [...win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
    const type = async (id: string, value: string) => {
      const input = win.document.getElementById(id) as HTMLInputElement;
      assert.ok(input, `${id} が無い`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
    };

    await act(async () => button('新しいカテゴリを作成').click());
    await type('attributeNewInput', '色/紫色系');
    await act(async () => button('追加する').click());
    await flush();

    await act(async () => button('選択を決定').click());
    assert.deepEqual(applied.at(-1), ['色', '色/紫色系']);
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
