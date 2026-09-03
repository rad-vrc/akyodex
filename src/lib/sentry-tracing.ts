/**
 * 遅延読み込みされる性能計測（BrowserTracing）のモジュール。
 * sentry-tracing-loader.ts からだけ動的 import される。
 *
 * `@sentry/react`（= @sentry/browser）の公開 API だけを使う。`@sentry/nextjs` のクライアント
 * barrel を動的 import すると Replay / Feedback まで別チャンクとして読み込まれ、遅延後の総 JS が
 * 大きく増える（実測 +100KB gzip 超）ためで、Next 用 SDK の App Router 計測と同じ振る舞いは
 * ここで再現する:
 *   - pageload: 汎用 integration の instrumentPageLoad に任せる
 *   - navigation: History 監視（instrumentNavigation）は無効にし、Next が遷移開始時に呼ぶ
 *     onRouterTransitionStart から startRouterTransitionSpan() で span を開始する。
 *     Next は RSC 応答を待ってから History を更新する遷移があるので、History 監視だけだと
 *     待ち時間が span から抜ける。フックの呼び出し時点を開始時刻にすれば Next 用 SDK と同じになる
 *
 * @sentry/core の addIntegration は後付けの integration にも afterAllSetup を呼ぶので、
 * 初期化済みクライアントへ後から追加できる。
 */
import {
  addIntegration,
  browserTracingIntegration,
  getClient,
  startBrowserTracingNavigationSpan,
} from '@sentry/react';

export interface RouterTransition {
  href: string;
  navigationType: string;
}

let installed = false;

/** 初期化済みクライアントへ BrowserTracing を 1 回だけ追加する。クライアントが無ければ false */
export function installBrowserTracing(): boolean {
  if (installed) {
    return true;
  }
  if (!getClient()) {
    return false;
  }
  // navigation は startRouterTransitionSpan() で作るので、History 監視による二重作成を防ぐ
  addIntegration(browserTracingIntegration({ instrumentNavigation: false }));
  installed = true;
  return true;
}

/** Next 用 SDK と同じく、"/" 以外の末尾スラッシュを落とした pathname を span 名にする */
export function routerTransitionSpanName(href: string, baseHref: string): string {
  const pathname = new URL(href, baseHref).pathname;
  return pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Next の onRouterTransitionStart（遷移開始）に対応する navigation span を開始する。
 * Next 用 SDK の captureRouterTransitionStart と同じ名前・属性で、開始時刻は呼び出し時点。
 * 戻り値は「span を開始した」かどうか（tracing 未インストールなら false）。
 */
export function startRouterTransitionSpan(transition: RouterTransition): boolean {
  const client = getClient();
  if (!installed || !client || typeof window === 'undefined') {
    return false;
  }
  let url: URL;
  try {
    url = new URL(transition.href, window.location.href);
  } catch {
    return false;
  }
  startBrowserTracingNavigationSpan(
    client,
    {
      name: routerTransitionSpanName(transition.href, window.location.href),
      op: 'navigation',
      attributes: {
        'sentry.origin': 'auto.navigation.nextjs.app_router_instrumentation',
        'sentry.source': 'url',
        'navigation.type': `router.${transition.navigationType}`,
      },
    },
    { url: url.href },
  );
  return true;
}
