import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

async function setup(role: 'owner' | 'admin') {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin', pretendToBeVisual: true });
  const win = dom.window;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const calls: Call[] = [];
  const confirms: string[] = [];
  let confirmAnswer = true;
  let categories = [
    { path: '動物', en: 'Animal', ko: '동물', count: 3 },
    { path: '動物/うま', en: 'Animal/Horse', ko: '동물/말', count: 2 },
    { path: '乗り物', en: 'Vehicle', ko: '탈것', count: 1 },
    { path: '未翻訳', en: null, ko: null, count: 1 },
  ];
  let postResponse: () => Response = () =>
    new Response(JSON.stringify({ success: true, message: 'done', commitUrl: 'https://github.com/x/commit/1', changedRows: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    HTMLElement: win.HTMLElement, Node: win.Node,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    getComputedStyle: win.getComputedStyle.bind(win),
    confirm: (text: string) => {
      confirms.push(text);
      return confirmAnswer;
    },
    alert: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, head: 'h', categories, colors: { '動物': '#111111' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return postResponse();
    },
  })) expose(key, value);
  const { createRoot } = await import('react-dom/client');
  const { CategoriesTab } = await import('./categories-tab');
  const root = createRoot(win.document.getElementById('root')!);
  // fetch → json → setState spans several microtasks; a macrotask turn inside act drains them all.
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(async () => root.render(createElement(CategoriesTab, { userRole: role })));
  await flush();
  const buttons = (text: string) =>
    [...win.document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === text);
  const rowOf = (path: string) =>
    [...win.document.querySelectorAll('li')].find((li) => li.querySelector('.font-medium')?.textContent?.startsWith(path.replace(/^(.*\/)?/, (_, parent: string | undefined) => parent ?? '')) && li.textContent?.includes(path.split('/').pop()!))!;
  const rowButton = (path: string, text: string) =>
    [...rowOf(path).querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!;
  const type = async (id: string, value: string) => {
    const input = win.document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };
  const select = async (id: string, value: string) => {
    const element = win.document.getElementById(id) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
  };
  const click = async (button: HTMLButtonElement) => {
    await act(async () => {
      button.click();
    });
    await flush();
  };
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
    win,
    calls,
    confirms,
    buttons,
    rowOf,
    rowButton,
    type,
    select,
    click,
    cleanup,
    setConfirm: (answer: boolean) => {
      confirmAnswer = answer;
    },
    setPostResponse: (factory: () => Response) => {
      postResponse = factory;
    },
    setCategories: (next: typeof categories) => {
      categories = next;
    },
  };
}

test('lists categories from the API, then renames with leaf translations and reloads', async () => {
  const h = await setup('owner');
  try {
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, '/api/categories');
    assert.match(h.win.document.body.textContent!, /全4件中 4件を表示/);
    assert.match(h.rowOf('動物/うま').textContent!, /Animal\/Horse/);
    assert.match(h.rowOf('未翻訳').textContent!, /対訳なし/);
    assert.equal(h.rowButton('未翻訳', '対訳を登録') !== undefined, true);

    await h.click(h.rowButton('動物/うま', '改名・対訳'));
    const ja = h.win.document.getElementById('category-editor-rename-ja') as HTMLInputElement;
    const en = h.win.document.getElementById('category-editor-rename-en') as HTMLInputElement;
    const ko = h.win.document.getElementById('category-editor-rename-ko') as HTMLInputElement;
    assert.equal(ja.value, '動物/うま');
    assert.equal(en.value, 'Horse', 'only the leaf of the EN translation is editable');
    assert.equal(ko.value, '말');

    await h.type('category-editor-rename-ja', '動物/ウマ');
    await h.type('category-editor-rename-en', 'Horse');
    await h.click(h.buttons('決定')[0]);
    const post = h.calls.find((call) => call.method === 'POST');
    assert.deepEqual(post?.body, { action: 'rename', from: '動物/うま', to: '動物/ウマ', en: 'Horse', ko: '말' });
    assert.equal(h.calls.filter((call) => call.method === 'GET').length, 2, 'the list is reloaded after a commit');
    assert.match(h.win.document.body.textContent!, /done/);
    assert.ok(h.win.document.querySelector('a[href="https://github.com/x/commit/1"]'));
    assert.equal(h.win.document.getElementById('category-editor-rename-ja'), null, 'editor closes on success');
  } finally {
    await h.cleanup();
  }
});

test('create under a parent sends the full path; merge and delete confirm with the row count', async () => {
  const h = await setup('owner');
  try {
    await h.click(h.rowButton('動物', '子を追加'));
    await h.type('category-editor-create-ja', 'ねこ');
    await h.type('category-editor-create-en', 'Cat');
    await h.type('category-editor-create-ko', '고양이');
    await h.click(h.buttons('作成する')[0]);
    assert.deepEqual(h.calls.at(-2)?.body, { action: 'create', path: '動物/ねこ', en: 'Cat', ko: '고양이' });

    await h.click(h.rowButton('乗り物', '統合'));
    const options = [...h.win.document.querySelectorAll('#category-editor-merge-into option')].map((option) => (option as HTMLOptionElement).value);
    assert.deepEqual(options, ['', '動物', '動物/うま', '未翻訳'], 'a category cannot be merged into itself');
    await h.click(h.buttons('統合する')[0]);
    assert.match(h.win.document.body.textContent!, /統合先を選んでください/);
    await h.select('category-editor-merge-into', '動物');
    h.setConfirm(false);
    await h.click(h.buttons('統合する')[0]);
    assert.match(h.confirms.at(-1)!, /「乗り物」を「動物」に統合します/);
    assert.match(h.confirms.at(-1)!, /1 件の Akyo/);
    assert.equal(h.calls.filter((call) => call.body?.action === 'merge').length, 0, 'cancelling the confirm sends nothing');
    h.setConfirm(true);
    await h.click(h.buttons('統合する')[0]);
    assert.deepEqual(h.calls.find((call) => call.body?.action === 'merge')?.body, { action: 'merge', from: '乗り物', into: '動物' });

    h.setConfirm(false);
    await h.click(h.rowButton('動物', '削除'));
    assert.match(h.confirms.at(-1)!, /3 件の Akyo から「動物」とその配下/);
    assert.equal(h.calls.filter((call) => call.body?.action === 'delete').length, 0);
    h.setConfirm(true);
    await h.click(h.rowButton('動物', '削除'));
    assert.deepEqual(h.calls.find((call) => call.body?.action === 'delete')?.body, { action: 'delete', path: '動物' });
  } finally {
    await h.cleanup();
  }
});

test('shows the server error inside the editor and keeps it open; admins cannot rename, merge or delete', async () => {
  const h = await setup('owner');
  try {
    h.setPostResponse(() => new Response(JSON.stringify({ success: false, error: 'カテゴリ「動物/ウマ」は既に存在します' }), { status: 409 }));
    await h.click(h.rowButton('動物/うま', '改名・対訳'));
    await h.type('category-editor-rename-ja', '動物/ウマ');
    await h.click(h.buttons('決定')[0]);
    assert.match(h.win.document.querySelector('[role="alert"]')!.textContent!, /既に存在します/);
    assert.ok(h.win.document.getElementById('category-editor-rename-ja'), 'editor stays open after a failure');
    assert.equal(h.calls.filter((call) => call.method === 'GET').length, 1, 'no reload after a failure');
  } finally {
    await h.cleanup();
  }

  const admin = await setup('admin');
  try {
    assert.equal(admin.rowButton('動物', '改名・対訳').disabled, true);
    assert.equal(admin.rowButton('動物', '統合').disabled, true);
    assert.equal(admin.rowButton('動物', '削除').disabled, true);
    assert.equal(admin.rowButton('動物', '子を追加').disabled, false);
    assert.equal(admin.rowButton('未翻訳', '対訳を登録').disabled, false, 'adding a missing translation is not structural');
  } finally {
    await admin.cleanup();
  }
});
