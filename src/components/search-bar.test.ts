import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const DEBOUNCE_MS = 30;
const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

// デバウンスのタイマーは発火時に、ref に写した入力値と無効状態を読む。
// 写し損ねると、確定した入力でも検索が走らないか、親が戻した古い入力で検索が走る
test('the debounced search reads the committed query and drops a search the parent reset', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/zukan', pretendToBeVisual: true });
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
    IS_REACT_ACT_ENVIRONMENT: true,
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { SearchBar } = await import('./search-bar');
  const root = createRoot(win.document.getElementById('root')!);
  const searches: string[] = [];
  const onSearch = (query: string) => { searches.push(query); };
  const render = (props: { value?: string; disabled?: boolean } = {}) =>
    act(async () => root.render(createElement(SearchBar, { onSearch, debounceMs: DEBOUNCE_MS, ...props })));
  const type = async (text: string) => {
    const input = win.document.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };
  const settle = () => act(async () => { await wait(DEBOUNCE_MS * 4); });
  try {
    // 読み込み中は無効で出て、あとから有効になる（図鑑の初回表示と同じ順）。
    // 有効になったことがタイマーに伝わらないと、ここで打った検索が走らない
    await render({ value: '', disabled: true });
    await render({ value: '' });
    await type('a');
    await type('ak');
    await type('akyo');
    await settle();
    assert.deepEqual(searches, ['akyo'], 'only the last input is searched, once, after the delay');

    // 待っている間に親が値を戻した（ランダム表示への切り替えなど）。古い入力の検索は捨てる
    await type('stale');
    await render({ value: 'reset' });
    await settle();
    assert.deepEqual(searches, ['akyo'], 'a search for input the parent replaced must not fire');
    assert.equal(win.document.querySelector<HTMLInputElement>('input')!.value, 'reset');

    // 無効の間に打った分は、有効に戻っても検索しない
    await type('while-enabled');
    await render({ value: 'reset', disabled: true });
    await settle();
    await render({ value: 'reset', disabled: false });
    await settle();
    assert.deepEqual(searches, ['akyo'], 'a search pending when the bar was disabled must not fire');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
