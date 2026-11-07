import { initBrowserSentry } from '@/lib/sentry-client-init';
import { readBrowserSentryRelease } from '@/lib/sentry-release';
import {
  forwardRouterTransitionStart,
  scheduleSentryTracingLoad,
} from '@/lib/sentry-tracing-loader';

/**
 * ブラウザ側の Sentry。
 * エラー捕捉・送信は hydration 前にここで初期化する（従来どおり）。
 * 性能計測（BrowserTracing）は初期バンドルに含めず、load 後の idle に動的 import で追加する。
 * 詳細は src/lib/sentry-client-init.ts と src/lib/sentry-tracing-loader.ts。
 */
const TRACING_IDLE_TIMEOUT_MS = 4000;

const initialized = initBrowserSentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  nodeEnv: process.env.NODE_ENV,
  // サーバーが <html data-sentry-release> に書いた Worker の版の印。JS に埋め込まない理由は sentry-release.ts
  release: readBrowserSentryRelease(typeof document === 'undefined' ? undefined : document),
});

if (initialized && typeof window !== 'undefined') {
  scheduleSentryTracingLoad(window, { idleTimeoutMs: TRACING_IDLE_TIMEOUT_MS });
}

/**
 * Next.js が App Router の遷移開始時に呼ぶフック。Next は RSC 応答を待ってから History を
 * 更新する遷移があるため、History 監視ではなくこの時点で navigation span を開始する
 * （Next 用 SDK の captureRouterTransitionStart 相当）。tracing の読み込み前は計測しない。
 */
export function onRouterTransitionStart(href: string, navigationType: string): void {
  forwardRouterTransitionStart(href, navigationType);
}
