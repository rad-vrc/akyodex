/**
 * 性能計測（BrowserTracing）の遅延読み込み。初期バンドルに残るのはこの小さな制御だけ。
 *
 *   - 読み込みは共有 Promise に集約する（初期化・再送・報告の重複を防ぐ）
 *   - 契機は load 後の requestIdleCallback（上限あり）。非対応環境は setTimeout
 *   - 読み込み失敗は有限回リトライし、最後は failed（性能計測なし）で確定する。エラー捕捉には影響しない
 *   - Next の onRouterTransitionStart（遷移開始）は同期 export が必要なので、ここで受けて
 *     読み込み済みの tracing へ転送する。読み込み前の遷移は Next 用 SDK と同じく計測しない
 */

type TracingModule = typeof import('./sentry-tracing');
type Importer = () => Promise<TracingModule>;

export interface TracingLoaderOptions {
  importer?: Importer;
  maxAttempts?: number;
  retryDelayMs?: number[];
  delay?: (ms: number) => Promise<void>;
}

export type TracingLoadResult = 'installed' | 'no-client' | 'failed';

const DEFAULT_RETRY_DELAYS_MS = [500, 2000];
const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultImporter: Importer = () => import('./sentry-tracing');

let loadPromise: Promise<TracingLoadResult> | null = null;
let loadedModule: TracingModule | null = null;

/**
 * tracing モジュールを読み込み、初期化済みクライアントへ BrowserTracing を追加する。
 * 何度呼んでも読み込みは 1 回。失敗が続いたら 'failed' で確定する。
 */
export function loadSentryTracing(options: TracingLoaderOptions = {}): Promise<TracingLoadResult> {
  if (loadPromise) {
    return loadPromise;
  }
  const importer = options.importer ?? defaultImporter;
  const delays = options.retryDelayMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAttempts = options.maxAttempts ?? delays.length + 1;
  const delay = options.delay ?? defaultDelay;

  loadPromise = (async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const mod = await importer();
        // クライアント未初期化（DSN 無しなど）なら計測は行わない
        if (!mod.installBrowserTracing()) {
          return 'no-client';
        }
        loadedModule = mod;
        return 'installed';
      } catch (error) {
        if (attempt >= maxAttempts) {
          console.warn('[sentry] tracing module failed to load; performance monitoring disabled', error);
          return 'failed';
        }
        await delay(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
      }
    }
    return 'failed';
  })();
  return loadPromise;
}

export interface ScheduleOptions {
  /** requestIdleCallback の timeout（ms）。これを過ぎたら idle でなくても読み込む */
  idleTimeoutMs: number;
  loader?: () => Promise<unknown>;
}

/**
 * ページの load 後、ブラウザが暇になったら（上限付き）tracing を読み込む。
 * 戻り値はキャンセル関数。
 */
export function scheduleSentryTracingLoad(win: Window, options: ScheduleOptions): () => void {
  const load = options.loader ?? (() => loadSentryTracing());
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;
  let cancelled = false;

  const start = () => {
    if (cancelled) return;
    if (typeof win.requestIdleCallback === 'function') {
      idleHandle = win.requestIdleCallback(() => void load(), { timeout: options.idleTimeoutMs });
    } else {
      timeoutHandle = win.setTimeout(() => void load(), options.idleTimeoutMs);
    }
  };

  if (win.document.readyState === 'complete') {
    start();
  } else {
    win.addEventListener('load', start, { once: true });
  }

  return () => {
    cancelled = true;
    win.removeEventListener('load', start);
    if (idleHandle !== null && typeof win.cancelIdleCallback === 'function') {
      win.cancelIdleCallback(idleHandle);
    }
    if (timeoutHandle !== null) {
      win.clearTimeout(timeoutHandle);
    }
  };
}

/**
 * Next の onRouterTransitionStart の実体。遷移開始の時点で navigation span を開始する
 * （RSC 応答待ちを含む所要時間になる）。tracing の読み込み前は Next 用 SDK と同じく計測しない。
 * 戻り値は span を開始したかどうか。
 */
export function forwardRouterTransitionStart(href: string, navigationType: string): boolean {
  return loadedModule?.startRouterTransitionSpan({ href, navigationType }) ?? false;
}

/** テスト用: 読み込み状態を初期化する */
export function resetSentryTracingLoaderForTests(): void {
  loadPromise = null;
  loadedModule = null;
}
