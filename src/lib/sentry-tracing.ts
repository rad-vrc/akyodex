/**
 * 遅延読み込みされる性能計測（BrowserTracing）のモジュール。
 * sentry-tracing-loader.ts からだけ動的 import される。
 *
 * `@sentry/react`（= @sentry/browser）の browserTracingIntegration を使う。
 * `@sentry/nextjs` の同名 integration は Next 固有のルーター計測（ルートのパラメータ化、
 * prefetch 属性）を足すが、クライアントの barrel を動的 import すると Replay / Feedback まで
 * 別チャンクとして読み込まれ、遅延後の総 JS が大きく増える（実測 +100KB gzip 超）。
 * このサイトのルートは静的パスだけなので、汎用の integration（history API で
 * pageload / navigation span を作る）で十分。
 *
 * @sentry/core の addIntegration は後付けの integration にも afterAllSetup を呼ぶので、
 * 初期化済みクライアントへ後から追加できる。
 */
import { addIntegration, browserTracingIntegration, getClient } from '@sentry/react';

let installed = false;

/** 初期化済みクライアントへ BrowserTracing を 1 回だけ追加する。クライアントが無ければ false */
export function installBrowserTracing(): boolean {
  if (installed) {
    return true;
  }
  if (!getClient()) {
    return false;
  }
  addIntegration(browserTracingIntegration());
  installed = true;
  return true;
}
