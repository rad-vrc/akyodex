import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";

/**
 * MiniAkyoBg の削減設定まわりの回帰テスト。
 *
 * 再現したい競合（PR #485 レビュー指摘）:
 *   1. 通常設定でマウント → init が画像プローブ（<img> の onload）を待つ
 *   2. 応答前に prefers-reduced-motion: reduce へ切替 → effect の cleanup が走り、
 *      コンポーネントは null を返して背景DOMが消える
 *   3. 応答が来る → 古い init が await から再開する
 * 修正前はここで維持 interval と resize listener が登録され、背景が無いのに残った。
 *
 * jsdom で実際にクライアントレンダリングし、Image / matchMedia / setInterval を
 * 差し替えて上記のタイミングを制御する。react-dom/client はモジュール初期化時に
 * DOM の有無を判定するため、グローバルを差し替えた後に動的 import する。
 */

type MediaListener = (e: { matches: boolean }) => void;

interface FakeImageLike {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface Harness {
  root: Root;
  mount: HTMLElement;
  /** 生成された Image プローブ（onload/onerror を外から発火できる） */
  images: FakeImageLike[];
  /** 現在動いている setInterval の数 */
  activeIntervals: () => number;
  /** window に登録中の resize リスナー数 */
  resizeListeners: () => number;
  /** prefers-reduced-motion を切り替えて change を通知 */
  setReducedMotion: (matches: boolean) => void;
  cleanup: () => void;
}

const G = globalThis as Record<string, unknown>;

async function createHarness(initialReduced: boolean): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div></body></html>', {
    url: "https://example.test/zukan",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;

  // --- グローバルを jsdom に向ける。Node 21+ の navigator など getter 専用の
  //     プロパティがあるため、代入ではなく記述子で差し替え、終了時に記述子で戻す ---
  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => {
    savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  // --- matchMedia: 切替可能なスタブ ---
  let reduced = initialReduced;
  const listeners = new Set<MediaListener>();
  const mql = {
    get matches() {
      return reduced;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, fn: MediaListener) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: MediaListener) => {
      listeners.delete(fn);
    },
  };
  win.matchMedia = (() => mql) as unknown as typeof win.matchMedia;

  // --- Image: 応答タイミングを外から制御する ---
  const images: FakeImageLike[] = [];
  class FakeImage implements FakeImageLike {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "";
    loading = "";
    private srcValue = "";
    set src(v: string) {
      this.srcValue = v;
      // 空文字は probeImage の finalize による後始末なので記録しない
      if (v) images.push(this);
    }
    get src() {
      return this.srcValue;
    }
  }
  win.Image = FakeImage as unknown as typeof win.Image;

  // --- setInterval / clearInterval の監視 ---
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const origSetInterval = win.setInterval.bind(win);
  const origClearInterval = win.clearInterval.bind(win);
  const trackedSetInterval = ((fn: TimerHandler, ms?: number) => {
    const id = origSetInterval(fn, ms);
    intervals.add(id as unknown as ReturnType<typeof setInterval>);
    return id;
  }) as typeof win.setInterval;
  const trackedClearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id as unknown as ReturnType<typeof setInterval>);
    origClearInterval(id);
  }) as typeof win.clearInterval;
  win.setInterval = trackedSetInterval;
  win.clearInterval = trackedClearInterval;

  // --- resize リスナーの監視（カウンタではなく実体で追跡） ---
  const resizeFns = new Set<unknown>();
  const origAdd = win.addEventListener.bind(win);
  const origRemove = win.removeEventListener.bind(win);
  win.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    if (type === "resize") resizeFns.add(fn);
    origAdd(type, fn, opts as AddEventListenerOptions);
  }) as typeof win.addEventListener;
  win.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
    if (type === "resize") resizeFns.delete(fn);
    origRemove(type, fn, opts as EventListenerOptions);
  }) as typeof win.removeEventListener;

  expose("window", win);
  expose("document", win.document);
  expose("navigator", win.navigator);
  expose("HTMLElement", win.HTMLElement);
  expose("HTMLDivElement", win.HTMLDivElement);
  expose("Node", win.Node);
  expose("setInterval", trackedSetInterval);
  expose("clearInterval", trackedClearInterval);
  expose("requestAnimationFrame", (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 0));
  expose("cancelAnimationFrame", (id: number) => win.clearTimeout(id));
  expose("IS_REACT_ACT_ENVIRONMENT", true);

  // グローバル設定後に読み込む（モジュール初期化時の DOM 判定のため）
  const { createRoot } = await import("react-dom/client");
  const mount = win.document.getElementById("mount") as HTMLElement;
  const root = createRoot(mount);

  return {
    root,
    mount,
    images,
    activeIntervals: () => intervals.size,
    resizeListeners: () => resizeFns.size,
    setReducedMotion: (matches) => {
      reduced = matches;
      for (const fn of listeners) fn({ matches });
    },
    cleanup: () => {
      for (const id of intervals) origClearInterval(id as unknown as number);
      for (const [key, desc] of savedDescriptors) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete G[key];
      }
      dom.window.close();
    },
  };
}

/** effect / state 更新 / 解決済み Promise を流す */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function loadComponent() {
  const mod = await import("./mini-akyo-bg");
  return mod.MiniAkyoBg;
}

test("reduced-motion へ切替後に画像プローブが完了しても、interval と resize listener は残らない", async (t) => {
  const h = await createHarness(false);
  t.after(() => h.cleanup());
  const MiniAkyoBg = await loadComponent();

  await act(async () => {
    h.root.render(createElement(MiniAkyoBg));
  });
  await flush();

  // 1) init が画像プローブを開始して待機中
  assert.ok(h.images.length >= 1, "画像プローブが開始されていること");
  assert.ok(h.mount.querySelector("#miniAkyoBg"), "通常設定では背景コンテナがマウントされる");
  assert.equal(h.activeIntervals(), 0, "応答前は interval なし");

  // 2) 応答前に削減設定へ切替 → cleanup が走り、背景DOMが消える
  await act(async () => {
    h.setReducedMotion(true);
  });
  await flush();
  assert.equal(h.mount.querySelector("#miniAkyoBg"), null, "削減設定では背景コンテナが消える");

  // 3) 応答を再開 → 古い init が await から戻る
  const pending = h.images[0];
  await act(async () => {
    pending.onload?.();
  });
  await flush();
  await flush();

  // 修正前はここで interval 1本と resize listener 1つが残った
  assert.equal(h.activeIntervals(), 0, "cleanup 後の古い init は interval を登録してはならない");
  assert.equal(h.resizeListeners(), 0, "cleanup 後の古い init は resize listener を登録してはならない");
  assert.equal(h.mount.querySelectorAll(".mini-akyo").length, 0, "背景要素は生成されない");

  await act(async () => {
    h.root.unmount();
  });
});

test("通常設定では init が完了して interval が動き、アンマウントで止まる", async (t) => {
  const h = await createHarness(false);
  t.after(() => h.cleanup());
  const MiniAkyoBg = await loadComponent();

  await act(async () => {
    h.root.render(createElement(MiniAkyoBg));
  });
  await flush();
  assert.ok(h.images.length >= 1, "画像プローブが開始されていること");

  await act(async () => {
    h.images[0].onload?.();
  });
  await flush();
  await flush();

  assert.equal(h.activeIntervals(), 1, "初期化完了後は維持 interval が1本");
  assert.equal(h.resizeListeners(), 1, "resize listener が1つ");
  assert.ok(h.mount.querySelectorAll(".mini-akyo").length > 0, "背景要素が生成される");

  await act(async () => {
    h.root.unmount();
  });
  assert.equal(h.activeIntervals(), 0, "アンマウントで interval が止まる");
  assert.equal(h.resizeListeners(), 0, "アンマウントで resize listener が外れる");
});

test("最初から reduced-motion なら何もマウントせず、プローブも走らない", async (t) => {
  const h = await createHarness(true);
  t.after(() => h.cleanup());
  const MiniAkyoBg = await loadComponent();

  await act(async () => {
    h.root.render(createElement(MiniAkyoBg));
  });
  await flush();

  assert.equal(h.mount.querySelector("#miniAkyoBg"), null, "背景コンテナはマウントされない");
  assert.equal(h.images.length, 0, "container が無いので画像プローブは開始されない");
  assert.equal(h.activeIntervals(), 0, "interval なし");

  await act(async () => {
    h.root.unmount();
  });
});
