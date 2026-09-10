import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

import type { AkyoData } from '@/types/akyo';

/**
 * 再取得したスナップショットに行が無ければ、それは本当に削除されている（保存先そのものを
 * 読んでいるので「まだ同期されていない」ではない）。一覧から消えるのは正しいが、その行に
 * 付けていた保留まで黙って捨てると、触ったつもりの変更が理由も分からず消える。
 */

function akyo(id: string, category = '動物'): AkyoData {
  const url = `https://vrchat.com/home/avatar/avtr_${id}`;
  return {
    id, nickname: `Akyo ${id}`, avatarName: `avatar_${id}`, author: 'tester', creator: 'tester',
    category, attribute: category, comment: '', notes: '', appearance: '',
    entryType: 'avatar', displaySerial: id, sourceUrl: url, avatarUrl: url,
  } as AkyoData;
}

async function mount() {
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
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
    alert: (): void => {}, confirm: (): boolean => true, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ success: true }),
  })) expose(key, value);

  const { createRoot } = await import('react-dom/client');
  const { CategoryAssignPanel } = await import('./category-assign-panel');
  const root = createRoot(win.document.getElementById('root')!);
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const pendingCounts: number[] = [];

  const render = async (rows: AkyoData[]) => {
    await act(async () => {
      root.render(createElement(CategoryAssignPanel, {
        akyoData: rows,
        selected: ['次元'],
        visible: true,
        blockedIds: new Set<string>(),
        onClearSelection: () => {},
        onPendingStateChange: (_pending: boolean, _busy: boolean, ids: string[] = []) => {
          pendingCounts.push(ids.length);
        },
        onCommitted: () => {},
      }));
    });
    await flush();
  };

  const cardFor = (id: string) =>
    (win.document.querySelector(`[aria-labelledby="card-title-${id}"]`) as HTMLElement | null) ?? undefined;

  const cleanup = async () => {
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    win.close();
  };
  return { win, render, cardFor, pendingCounts, cleanup };
}

test('スナップショットから消えた行の保留を、黙って捨てない', async () => {
  const screen = await mount();
  try {
    await screen.render([akyo('0001'), akyo('0002')]);
    const card = screen.cardFor('0002');
    assert.ok(card, 'カードが出ていること');
    const trigger = card!.querySelector<HTMLButtonElement>('[data-card-trigger="true"]');
    assert.ok(trigger, 'カードの押下対象があること');
    await act(async () => trigger!.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(card!.dataset.pending, 'true', '保留に入ったこと');

    // 再取得の結果 0002 が消えた（本当に削除された）
    await screen.render([akyo('0001')]);
    assert.equal(screen.cardFor('0002'), undefined, '一覧からは消える');
    assert.equal(
      screen.pendingCounts[screen.pendingCounts.length - 1],
      1,
      '保留は残す。黙って捨てると、触ったつもりの変更が理由も分からず消える',
    );
    assert.match(
      screen.win.document.body.textContent ?? '',
      /#0002 は一覧から消えました/,
      'どの ID がそうなったかを知らせる',
    );
  } finally {
    await screen.cleanup();
  }
});
