import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

/**
 * 「新しいカテゴリを作成」は GitHub へのコミットなので、IME の変換確定 Enter で走らせない。
 */
test('AttributeModal: Enter during IME composition does not create; a real Enter does', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const posts: unknown[] = [];
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node, KeyboardEvent: win.KeyboardEvent,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    alert: () => {}, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      assert.equal(url, '/api/categories');
      const body = JSON.parse(String(init?.body));
      posts.push(body);
      // The server answers with every path it registered, ancestors included.
      const createdPaths = [
        ...(body.ancestors ?? []).map((entry: { path: string }) => entry.path),
        body.path,
      ];
      return new Response(JSON.stringify({ success: true, createdPaths }), { status: 200 });
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { AttributeModal } = await import('./attribute-modal');
  const root = createRoot(win.document.getElementById('root')!);
  const created: string[] = [];
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  try {
    await act(async () =>
      root.render(createElement(AttributeModal, {
        isOpen: true, onClose: () => {}, currentAttributes: [], onApply: () => {},
        allAttributes: ['動物', 'Cat'], onCreateAttribute: (name: string) => created.push(name),
      })),
    );
    const button = (text: string) => [...win.document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
    await act(async () => button('新しいカテゴリを作成').click());
    const type = async (id: string, value: string) => {
      const input = win.document.getElementById(id) as HTMLInputElement;
      assert.ok(input, `${id} が無い`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
    };
    await type('attributeNewInput', '動物/ねこ');
    assert.equal(
      win.document.getElementById('attributeNewEnInput-動物'),
      null,
      '既にある階層の名前は訊かない',
    );
    await type('attributeNewEnInput-動物/ねこ', 'Cat');
    await type('attributeNewKoInput-動物/ねこ', '고양이');
    const ko = win.document.getElementById('attributeNewKoInput-動物/ねこ')!;
    await act(async () => {
      ko.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    });
    await flush();
    assert.equal(posts.length, 0, 'composition Enter must not commit');
    await act(async () => {
      ko.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, keyCode: 229 }));
    });
    await flush();
    assert.equal(posts.length, 0, 'keyCode 229 is also composition');
    await act(async () => {
      ko.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await flush();
    assert.deepEqual(posts, [
      { action: 'create', path: '動物/ねこ', en: 'Cat', ko: '고양이', ancestors: [] },
    ]);
    assert.deepEqual(created, ['動物/ねこ']);
    assert.ok(button('動物/ねこ'), 'the new category is listed and selectable');

    // 親も子も無い枝をまとめて作る。Akyo 側の画面は未登録カテゴリを書けないので、
    // ここで作れないと新しい枝を足す手段がどこにも無い
    await act(async () => button('新しいカテゴリを作成').click());
    await type('attributeNewInput', '植物/木');
    await type('attributeNewEnInput-植物', 'Plant');
    await type('attributeNewKoInput-植物', '식물');
    await type('attributeNewEnInput-植物/木', 'Tree');
    await type('attributeNewKoInput-植物/木', '나무');
    await act(async () => button('追加する').click());
    await flush();
    assert.deepEqual(posts[1], {
      action: 'create',
      path: '植物/木',
      en: 'Tree',
      ko: '나무',
      ancestors: [{ path: '植物', en: 'Plant', ko: '식물' }],
    });

    // 一緒に作られた「植物」を一覧に入れ忘れると、同じ親の下にもう 1 つ作るときに
    // 存在しない親の対訳を送ってしまい、サーバーに拒否される
    await act(async () => button('新しいカテゴリを作成').click());
    await type('attributeNewInput', '植物/草');
    assert.equal(
      win.document.getElementById('attributeNewEnInput-植物'),
      null,
      'さっき作った親はもう既存として扱う',
    );
    await type('attributeNewEnInput-植物/草', 'Grass');
    await type('attributeNewKoInput-植物/草', '풀');
    await act(async () => button('追加する').click());
    await flush();
    assert.deepEqual(posts[2], {
      action: 'create',
      path: '植物/草',
      en: 'Grass',
      ko: '풀',
      ancestors: [],
    });

    // 大文字小文字だけが違う階層は、並ぶと見分けが付かないので送らせない。
    // 末尾は isDuplicate が拾うが、途中の階層はここでしか止まらない
    await act(async () => button('新しいカテゴリを作成').click());
    await type('attributeNewInput', 'cat/kitten');
    await type('attributeNewEnInput-cat', 'Cat');
    await type('attributeNewKoInput-cat', '고양이');
    await type('attributeNewEnInput-cat/kitten', 'Kitten');
    await type('attributeNewKoInput-cat/kitten', '새끼');
    await act(async () => button('追加する').click());
    await flush();
    assert.equal(posts.length, 3, '紛らわしい名前は送らない');
    assert.match(win.document.body.textContent!, /「cat」は既存の「Cat」と/);
    assert.match(win.document.body.textContent!, /別の名前にしてください/);

    // 画面が見せた階層と、送るパスを一致させる。原文のままだと「植物/ 木」が
    // そのまま飛んで、入力欄のキー（植物/木）とも食い違う
    await type('attributeNewInput', '植物/ 苔');
    await type('attributeNewEnInput-植物/苔', 'Moss');
    await type('attributeNewKoInput-植物/苔', '이끼');
    await act(async () => button('追加する').click());
    await flush();
    assert.deepEqual(posts[3], {
      action: 'create',
      path: '植物/苔',
      en: 'Moss',
      ko: '이끼',
      ancestors: [],
    });
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
