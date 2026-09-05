import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useRef, useState, type RefObject } from "react";
import type { Root } from "react-dom/client";

import { AttributeModal } from "./attribute-modal";
import { useModalDialog } from "@/hooks/use-modal-dialog";

/**
 * AttributeModal（カテゴリ管理モーダル）のフォーカス管理の回帰テスト。
 *
 * WAI-ARIA APG Modal Dialog パターンのうち、
 * - 開いたら子（検索欄）にフォーカスが移る
 * - Tab / Shift+Tab が子の中で循環する
 * - Escape で閉じる
 * - 閉じたら「カテゴリを管理」ボタンへ戻る
 * を固定する。jsdom の組み立ては use-modal-dialog.test.ts と同じ。
 *
 * 呼び出し元は 2 通りある。
 * - AddTab: 親にフォーカストラップが無い
 * - EditModal: 親も useModalDialog を張っていて、子表示中は suspended=true で止める
 * どちらでも同じ挙動になることを確認する。
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
  expose("HTMLInputElement", win.HTMLInputElement);
  expose("HTMLButtonElement", win.HTMLButtonElement);
  expose("Node", win.Node);
  expose("KeyboardEvent", win.KeyboardEvent);
  expose("MouseEvent", win.MouseEvent);
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

/** effect と 0ms rAF（初期フォーカス / 復帰フォーカス）を流す */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

const OPEN_BUTTON_ID = "openAttributeModal";
const ATTRIBUTES = ["動物", "ワールド", "食べ物"];

/** AddTab 相当: 親にフォーカストラップは無く、ボタンでモーダルを開くだけ */
function PlainHost() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("input", { id: "behind", type: "text" }),
    createElement(
      "button",
      { id: OPEN_BUTTON_ID, type: "button", onClick: () => setOpen(true) },
      "カテゴリを管理",
    ),
    createElement(AttributeModal, {
      isOpen: open,
      onClose: () => setOpen(false),
      currentAttributes: [],
      onApply: () => {},
      allAttributes: ATTRIBUTES,
    }),
  );
}

/** EditModal 相当: 親も useModalDialog を張り、子表示中は suspended=true にする */
function TrappedHost({ onParentClose }: { onParentClose: () => void }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useModalDialog({
    isOpen: true,
    onRequestClose: onParentClose,
    dialogRef: dialogRef as RefObject<HTMLElement | null>,
    initialFocusRef: closeRef as RefObject<HTMLElement | null>,
    suspended: open,
  });
  return createElement(
    "div",
    // eslint-disable-next-line react-hooks/refs
    { ref: dialogRef, role: "dialog", tabIndex: -1 },
    // eslint-disable-next-line react-hooks/refs
    createElement("button", { ref: closeRef, id: "parentClose", type: "button" }, "閉じる"),
    createElement("input", { id: "behind", type: "text" }),
    createElement(
      "button",
      { id: OPEN_BUTTON_ID, type: "button", onClick: () => setOpen(true) },
      "カテゴリを管理",
    ),
    createElement(AttributeModal, {
      isOpen: open,
      onClose: () => setOpen(false),
      currentAttributes: [],
      onApply: () => {},
      allAttributes: ATTRIBUTES,
    }),
  );
}

function dispatchKey(
  win: Window & typeof globalThis,
  key: "Tab" | "Escape",
  init: { shiftKey?: boolean } = {},
) {
  const target = win.document.activeElement ?? win.document;
  target.dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: init.shiftKey ?? false,
    }),
  );
}

/** 「カテゴリを管理」を押してモーダルを開き、初期フォーカスまで流す */
async function openModal(h: Harness) {
  const button = h.win.document.getElementById(OPEN_BUTTON_ID) as HTMLButtonElement;
  button.focus();
  await act(async () => {
    button.click();
  });
  await flush();
}

function getDialog(h: Harness): HTMLElement {
  const dialog = h.win.document.querySelector<HTMLElement>('[aria-labelledby="attributeModalTitle"]');
  assert.ok(dialog, "カテゴリ管理モーダルが描画されていない");
  return dialog;
}

function getSearchInput(h: Harness): HTMLInputElement {
  const input = getDialog(h).querySelector<HTMLInputElement>('input[type="search"]');
  assert.ok(input, "検索欄が無い");
  return input;
}

async function withHost(host: () => ReturnType<typeof createElement>, run: (h: Harness) => Promise<void>) {
  const h = await createHarness();
  try {
    await act(async () => {
      h.root.render(host());
    });
    await flush();
    await run(h);
  } finally {
    // アサーション失敗時も必ず unmount する。飛ばすとフックの keydown リスナーや
    // タイマーが残り、node:test が終了せずハングする
    await act(async () => {
      h.root.unmount();
    });
    h.cleanup();
  }
}

for (const [label, host] of [
  ["AddTab 相当（親トラップ無し）", () => createElement(PlainHost)],
  ["EditModal 相当（親トラップを suspended で停止）", () => createElement(TrappedHost, { onParentClose: () => {} })],
] as const) {
  test(`${label}: 開いたら検索欄にフォーカスが移る`, async () => {
    await withHost(host, async (h) => {
      await openModal(h);
      // DOM ノード同士を assert.equal に渡すと失敗時の deep diff が数十秒かかるので === で比べる
      assert.ok(h.win.document.activeElement === getSearchInput(h), "検索欄にフォーカスが移っていない");
    });
  });

  test(`${label}: Tab / Shift+Tab がモーダル内で循環する`, async () => {
    await withHost(host, async (h) => {
      await openModal(h);
      const dialog = getDialog(h);
      const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      assert.equal(last.textContent, "選択を決定");

      last.focus();
      dispatchKey(h.win, "Tab");
      assert.ok(h.win.document.activeElement === first, "末尾から Tab で先頭へ戻る");

      dispatchKey(h.win, "Tab", { shiftKey: true });
      assert.ok(h.win.document.activeElement === last, "先頭から Shift+Tab で末尾へ回る");

      // 背面の入力欄に居てもトラップがモーダル内へ引き戻す
      (h.win.document.getElementById("behind") as HTMLInputElement).focus();
      dispatchKey(h.win, "Tab");
      assert.ok(dialog.contains(h.win.document.activeElement), "背面へ抜けてはいけない");
    });
  });

  test(`${label}: Escape で閉じ、「カテゴリを管理」ボタンへフォーカスが戻る`, async () => {
    await withHost(host, async (h) => {
      await openModal(h);
      assert.ok(getDialog(h));

      await act(async () => {
        dispatchKey(h.win, "Escape");
      });
      await flush();

      assert.ok(
        h.win.document.querySelector('[aria-labelledby="attributeModalTitle"]') === null,
        "Escape で閉じていない",
      );
      assert.equal(h.win.document.activeElement?.id, OPEN_BUTTON_ID);
    });
  });
}

// レビュー指摘（P2）: 親子がそれぞれ body.style.overflow を保存・復元すると、画面遷移などで
// 親子が同時にアンマウントされたとき「親が元の値へ戻す → 子が親の設定した hidden を戻す」の
// 順で走り、モーダルが消えた後もスクロールロックが残っていた。
test("EditModal 相当: 親子を開いたまま同時にアンマウントしても body のスクロールロックが残らない", async () => {
  const h = await createHarness();
  try {
    h.win.document.body.style.overflow = "scroll";
    await act(async () => {
      h.root.render(createElement(TrappedHost, { onParentClose: () => {} }));
    });
    await flush();
    assert.equal(h.win.document.body.style.overflow, "hidden", "親を開いたらロックされる");

    await openModal(h);
    assert.equal(h.win.document.body.style.overflow, "hidden", "子を開いてもロックは維持される");

    // 画面遷移に相当: 親子まとめて消える
    await act(async () => {
      h.root.unmount();
    });
    await flush();
    assert.equal(h.win.document.body.style.overflow, "scroll", "親子同時終了で元の値へ戻る");
  } finally {
    h.cleanup();
  }
});

test("EditModal 相当: 子だけを閉じても親のスクロールロックは維持される", async () => {
  await withHost(
    () => createElement(TrappedHost, { onParentClose: () => {} }),
    async (h) => {
      await openModal(h);
      await act(async () => {
        dispatchKey(h.win, "Escape");
      });
      await flush();
      assert.equal(h.win.document.body.style.overflow, "hidden", "子を閉じた時点で親のロックが外れている");
    },
  );
});

test("EditModal 相当: 子の Escape は親の onRequestClose を呼ばず、閉じた後も親の初期フォーカスを奪い返さない", async () => {
  let parentCloseCalls = 0;
  await withHost(
    () => createElement(TrappedHost, { onParentClose: () => { parentCloseCalls += 1; } }),
    async (h) => {
      // 親だけの状態では親の initialFocusRef へ
      assert.equal(h.win.document.activeElement?.id, "parentClose");

      await openModal(h);
      assert.ok(h.win.document.activeElement === getSearchInput(h), "親が子の初期フォーカスを奪っている");

      await act(async () => {
        dispatchKey(h.win, "Escape");
      });
      await flush();
      assert.equal(parentCloseCalls, 0, "子を閉じる Escape が親にも届いている");

      // 50ms フォールバックが走っても、復帰先（ボタン）から親の閉じるボタンへ引き戻さない
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });
      assert.equal(h.win.document.activeElement?.id, OPEN_BUTTON_ID);

      // 子が閉じた後は親の Escape が再び効く
      await act(async () => {
        dispatchKey(h.win, "Escape");
      });
      assert.equal(parentCloseCalls, 1);
    },
  );
});
