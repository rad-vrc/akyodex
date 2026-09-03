import { initBrowserSentry } from '@/lib/sentry-client-init';
import { scheduleSentryTracingLoad } from '@/lib/sentry-tracing-loader';

/**
 * ブラウザ側の Sentry。
 * エラー捕捉・送信は hydration 前にここで初期化する（従来どおり）。
 * 性能計測（BrowserTracing）は初期バンドルに含めず、load 後の idle に動的 import で追加する。
 * 画面遷移の span は汎用の BrowserTracing が history API から作るので、Next 固有の
 * onRouterTransitionStart は使わない。
 * 詳細は src/lib/sentry-client-init.ts と src/lib/sentry-tracing-loader.ts。
 */
const TRACING_IDLE_TIMEOUT_MS = 4000;

const initialized = initBrowserSentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  nodeEnv: process.env.NODE_ENV,
});

if (initialized && typeof window !== 'undefined') {
  scheduleSentryTracingLoad(window, { idleTimeoutMs: TRACING_IDLE_TIMEOUT_MS });
}
