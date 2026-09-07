'use client';

import { useSyncExternalStore } from 'react';

/**
 * 画面が狭いか（Tailwind の sm 未満か）を返す。
 *
 * 検索プレースホルダのように、CSS では出し分けられないテキストを
 * 幅で切り替えるために使う。placeholder は属性なのでメディアクエリでは
 * 変えられない。
 *
 * 境界はサイトが他で使っている sm(640px) に合わせている。実測では
 * 640px で長い方の文言（395px）が表示可能幅 452px に収まる。
 */
const COMPACT_QUERY = '(max-width: 639.98px)';

function subscribe(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(COMPACT_QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(COMPACT_QUERY).matches;
}

/** サーバー側では判定できないので広い方を返す。狭ければマウント後に切り替わる。 */
function getServerSnapshot() {
  return false;
}

export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
