import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useRef, type RefObject } from "react";
import type { Root } from "react-dom/client";

import { isComposingKeyboardEvent, useModalDialog } from "./use-modal-dialog";

/**
 * useModalDialog の Escape 処理の回帰テスト（PR #497 レビュー指摘）。
 *
 * 日本語入力の変換取消に使う Escape をモーダルの終了操作として拾ってはいけない。
 * jsdom で実際にフックをマウントし、document に keydown を流して onRequestClose の
 * 呼び出し回数を数える。mini-akyo-bg.test.ts と同じく、react-dom/client は
 * グローバルを jsdom に向けた後に動的 import する。
 */

const G = globalThis as Record<string, unknown>;

interface Harness {
  win: Window & typeof globalThis;
  root: Root;
  cleanup: () => void;
}

async function createHarness(): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', {
    url: "https://example.test/admin",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;

  const saved = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  expose("window", win);
  expose("document", win.document);
  expose("navigator", win.navigator);
  expose("HTMLElement", win.HTMLElement);
  expose("HTMLDivElement", win.HTMLDivElement);
  expose("Node", win.Node);
  expose("KeyboardEvent", win.KeyboardEvent);
  // フックは window.requestAnimationFrame を呼ぶ。jsdom 標準の rAF は約16ms周期なので
  // 0ms の setTimeout に差し替え、flush の待ち時間内に初期フォーカスが走るようにする
  const immediateRaf = (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 0);
  const cancelRaf = (id: number) => win.clearTimeout(id);
  win.requestAnimationFrame = immediateRaf as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = cancelRaf as typeof win.cancelAnimationFrame;
  expose("requestAnimationFrame", immediateRaf);
  expose("cancelAnimationFrame", cancelRaf);
  expose("IS_REACT_ACT_ENVIRONMENT", true);

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(win.document.getElementById("mount") as HTMLElement);

  return {
    win,
    root,
    cleanup: () => {
      for (const [key, desc] of saved) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete G[key];
      }
      dom.window.close();
    },
  };
}

/** effect と 0ms rAF（初期フォーカス）を流す */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

interface DialogProps {
  onRequestClose: () => void;
  suspended?: boolean;
}

function Dialog({ onRequestClose, suspended = false }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useModalDialog({
    isOpen: true,
    onRequestClose,
    dialogRef: dialogRef as RefObject<HTMLElement | null>,
    initialFocusRef: inputRef as RefObject<HTMLElement | null>,
    suspended,
  });
  // テストファイルは CI の glob（*.test.ts）に合わせて .ts なので JSX が使えず
  // createElement に ref を渡す。react-hooks/refs はこれを「関数への ref 渡し」と
  // 見るが、React 要素の props なので描画中に読まれることはない
  return createElement(
    "div",
    // eslint-disable-next-line react-hooks/refs
    { ref: dialogRef, role: "dialog", tabIndex: -1 },
    // eslint-disable-next-line react-hooks/refs
    createElement("input", { ref: inputRef, type: "text" }),
    createElement("button", { type: "button" }, "ok"),
  );
}

function dispatchEscape(
  win: Window & typeof globalThis,
  init: { isComposing?: boolean; keyCode?: number } = {},
) {
  const event = new win.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    isComposing: init.isComposing ?? false,
  });
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: init.keyCode });
  }
  win.document.dispatchEvent(event);
}

test("isComposingKeyboardEvent は変換中のイベントだけを true にする", () => {
  assert.equal(isComposingKeyboardEvent({ isComposing: true, keyCode: 27 }), true);
  assert.equal(isComposingKeyboardEvent({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isComposingKeyboardEvent({ isComposing: false, keyCode: 27 }), false);
});

test("IME 変換中の Escape ではモーダルを閉じず、変換確定後の Escape で閉じる", async () => {
  const h = await createHarness();
  try {
    let closeCalls = 0;
    await act(async () => {
      h.root.render(createElement(Dialog, { onRequestClose: () => { closeCalls += 1; } }));
    });
    await flush();

    // 変換セッション中（isComposing: true）
    dispatchEscape(h.win, { isComposing: true });
    assert.equal(closeCalls, 0, "変換中の Escape で閉じてはいけない");

    // keyCode 229 だけ立つ実装向け
    dispatchEscape(h.win, { isComposing: false, keyCode: 229 });
    assert.equal(closeCalls, 0, "keyCode 229 の Escape で閉じてはいけない");

    // 変換確定後の通常 Escape
    dispatchEscape(h.win, { isComposing: false });
    assert.equal(closeCalls, 1, "通常の Escape では閉じる");

    await act(async () => {
      h.root.unmount();
    });
  } finally {
    h.cleanup();
  }
});

test("suspended の間は Escape を無視する（子モーダル表示中）", async () => {
  const h = await createHarness();
  try {
    let closeCalls = 0;
    await act(async () => {
      h.root.render(
        createElement(Dialog, { onRequestClose: () => { closeCalls += 1; }, suspended: true }),
      );
    });
    await flush();

    dispatchEscape(h.win);
    assert.equal(closeCalls, 0);

    await act(async () => {
      h.root.unmount();
    });
  } finally {
    h.cleanup();
  }
});

test("開いたら initialFocusRef の要素にフォーカスが移る", async () => {
  const h = await createHarness();
  try {
    await act(async () => {
      h.root.render(createElement(Dialog, { onRequestClose: () => {} }));
    });
    await flush();

    assert.equal(h.win.document.activeElement?.tagName, "INPUT");

    await act(async () => {
      h.root.unmount();
    });
  } finally {
    h.cleanup();
  }
});
