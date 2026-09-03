/**
 * ブラウザ側 Sentry の初期化（hydration 前、instrumentation-client.ts から呼ぶ）。
 *
 * `@sentry/nextjs` のクライアント init ではなく `@sentry/react` の init を使う。
 * 理由: Next 用 SDK のクライアント init は browserTracingIntegration を静的に import して
 * 既定で追加するため、性能計測（tracing）のコードを初期バンドルから外せない。
 * ここではエラー捕捉・送信に必要なものだけを初期化し、tracing は
 * sentry-tracing-loader.ts が後から動的 import で追加する。
 *
 * Next 用 SDK のクライアント init が行っていた「性能計測以外」の処理は、ここで同等に再現する。
 *   - スタックフレームの補正: `<origin>/_next/...` → `app:///_next/...`（nextjsClientStackFrameNormalizationIntegration 相当）
 *   - NEXT_REDIRECT（redirect() が投げる制御用エラー）を送らない（NextRedirectErrorFilter 相当）
 *   - /404 と名前が確定しなかった app router トランザクションの span を無視（ignoreSpans）
 *   - Turbopack ビルドのタグ
 * 再現していないもの: SDK メタデータ名（sentry.javascript.nextjs → react）、tunnelRoute（未使用）、
 * release の自動注入（withSentryConfig を Cloudflare ビルドでは適用しておらず、従来も未設定）、
 * ISR/SSG ページの sentry-trace meta 除去（tracing 側の処理で、対象ルートも無い）。
 */
import * as Sentry from '@sentry/react';

export const INCOMPLETE_APP_ROUTER_TRANSACTION_NAME = 'incomplete-app-router-transaction';

/** Next.js の内部チャンク。Next 用 SDK と同じ判定で in_app=false にする */
const NEXT_FRAMEWORK_CHUNK_PATTERN =
  /^app:\/\/\/_next\/static\/chunks\/(main-|main-app-|polyfills-|webpack-|framework-|framework\.)[0-9a-f]+\.js$/;

type StackFrameLike = { filename?: string; in_app?: boolean };

/**
 * Next 用 SDK の nextjsClientStackFrameNormalizationIntegration（assetPrefix / basePath 無し、
 * experimentalThirdPartyOriginStackFrames 無効）の iteratee と同じ変換。
 */
export function normalizeNextStackFrame<T extends StackFrameLike>(frame: T): T {
  try {
    const { origin } = new URL(frame.filename ?? '');
    frame.filename = frame.filename?.replace(origin, 'app://');
  } catch {
    // URL でないファイル名（<anonymous> など）はそのまま
  }
  if (frame.filename?.startsWith('app:///_next')) {
    frame.filename = decodeURI(frame.filename);
  }
  if (frame.filename && NEXT_FRAMEWORK_CHUNK_PATTERN.test(frame.filename)) {
    frame.in_app = false;
  }
  return frame;
}

/** Next の redirect() が投げる制御用エラー（digest が NEXT_REDIRECT; で始まる） */
export function isNextRedirectError(value: unknown): boolean {
  if (!(value instanceof Error)) {
    return false;
  }
  const digest = (value as Error & { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;');
}

type EventLike = { exception?: { values?: Array<{ value?: string }> } };
type HintLike = { originalException?: unknown };

/** Next 用 SDK の NextRedirectErrorFilter と同じ: redirect の制御用エラーは送らない */
export function filterNextRedirectEvent<E extends EventLike>(event: E, hint?: HintLike): E | null {
  if (isNextRedirectError(hint?.originalException)) {
    return null;
  }
  if (event.exception?.values?.[0]?.value === 'NEXT_REDIRECT') {
    return null;
  }
  return event;
}

export interface BrowserSentryEnv {
  dsn?: string;
  environment?: string;
  nodeEnv?: string;
}

/**
 * instrumentation-client.ts が従来渡していたオプションと同じ内容を組み立てる。
 * DSN が無ければ null（初期化しない）。
 */
export function resolveBrowserSentryOptions(env: BrowserSentryEnv): Sentry.BrowserOptions | null {
  if (!env.dsn) {
    return null;
  }
  return {
    dsn: env.dsn,
    environment: env.environment ?? env.nodeEnv ?? 'production',
    enableMetrics: true,
    tracesSampleRate: env.nodeEnv === 'development' ? 1.0 : 0.1,
    sendDefaultPii: false,
    integrations: (defaults) => [
      ...defaults,
      Sentry.rewriteFramesIntegration({ iteratee: normalizeNextStackFrame }),
    ],
    ignoreSpans: [/^\/404$/, new RegExp(`^${INCOMPLETE_APP_ROUTER_TRANSACTION_NAME}$`)],
  };
}

let initialized = false;

/**
 * 1 回だけ初期化する。戻り値は「初期化した（= DSN があった）」かどうか。
 * tracing は含まない。呼び出し側が sentry-tracing-loader で後から追加する。
 */
export function initBrowserSentry(env: BrowserSentryEnv): boolean {
  if (initialized) {
    return true;
  }
  const options = resolveBrowserSentryOptions(env);
  if (!options) {
    return false;
  }
  Sentry.init(options);
  Sentry.addEventProcessor(filterNextRedirectEvent);
  try {
    if ((process as unknown as { turbopack?: boolean }).turbopack) {
      Sentry.getGlobalScope().setTag('turbopack', true);
    }
  } catch {
    // process が無い環境
  }
  initialized = true;
  return true;
}
