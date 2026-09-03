/**
 * Service Worker 登録の中身。コンポーネント（service-worker-register.tsx）から
 * 切り出した、DOM・React に依存しない純粋ロジック。
 *
 * 振る舞いの要点:
 *   - `register()` が成功しても登録オブジェクトを返さない（undefined / null）環境がある。
 *     仕様上は成功時に必ず ServiceWorkerRegistration が返るので、これは自動化環境などの
 *     非標準挙動。以降に扱う対象が無いので、state・listener・interval を作らず、
 *     エラー報告もしない（本物の登録失敗の報告は従来どおり行う）。
 *   - `register()` を待っている間にコンポーネントがアンマウントされたら、遅れて登録が
 *     完了しても配線しない（interval や listener を作らない）。
 */
import { isGoogleWrsServiceWorkerRejection } from './service-worker-errors';

export type ServiceWorkerPhase = 'register' | 'update';

export interface ServiceWorkerLike {
  state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  scope: string;
  installing: ServiceWorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export interface ServiceWorkerRegistrarDeps<R extends ServiceWorkerRegistrationLike> {
  /** navigator.serviceWorker.register('/sw.js', { scope: '/' }) 相当 */
  register(): Promise<R | null | undefined>;
  /** navigator.serviceWorker.controller の有無 */
  hasController(): boolean;
  /** コンポーネントがアンマウント済みなら true。await の後に必ず確認する */
  isDisposed(): boolean;
  isOnline(): boolean;
  readyState(): string;
  onRegistered(registration: R): void;
  onUpdateAvailable(): void;
  /** 作成直後に同期で呼ぶ。呼び出し側は cleanup で clearInterval できるよう保持する */
  onIntervalCreated(id: number): void;
  reportError(
    phase: ServiceWorkerPhase,
    error: unknown,
    additional?: Record<string, unknown>,
  ): void;
  setInterval(callback: () => void, ms: number): number;
  log?: (...args: unknown[]) => void;
  logError?: (...args: unknown[]) => void;
}

export type ServiceWorkerRegistrationOutcome =
  | 'registered'
  | 'no-registration'
  | 'disposed'
  | 'failed';

export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/** 報告しない登録・更新エラー（未対応環境、セキュリティ制約、Google WRS の既知挙動） */
export function isExpectedServiceWorkerError(
  phase: ServiceWorkerPhase,
  error: unknown,
): boolean {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const { message, name } = normalizedError;
  return (
    message.includes('Service Workers are not supported') ||
    message.includes('The operation is insecure') ||
    message.includes('Failed to register a ServiceWorker') ||
    name === 'SecurityError' ||
    (phase === 'register' && isGoogleWrsServiceWorkerRejection(error))
  );
}

/** update() の失敗のうち、報告しないもの（更新失敗、リダイレクト、オフライン中のネットワーク失敗） */
export function shouldIgnoreUpdateError(error: unknown, online: boolean): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const isGenericNetworkError =
    message.includes('a bad http response code') || message.includes('failed to fetch');
  return (
    message.includes('failed to update a serviceworker') ||
    message.includes('the script resource is behind a redirect') ||
    (!online && isGenericNetworkError)
  );
}

/**
 * Sentry の extra に載せる追加情報の防御的な絞り込み。
 * scope は pathname だけにし、URL・クエリ・資格情報らしきキーや値は落とす。
 */
export function sanitizeServiceWorkerExtra(
  rawAdditional: Record<string, unknown>,
  origin: string,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawAdditional)) {
    if (key === 'scope' && typeof value === 'string') {
      try {
        const parsedScope = new URL(value, origin);
        sanitized.scope = parsedScope.pathname || '/';
      } catch {
        sanitized.scope = '/';
      }
      continue;
    }

    if (/(^|_|-)(url|href|query|search|token|email)(_|-|$)/i.test(key)) {
      continue;
    }

    if (
      typeof value === 'string' &&
      (value.includes('://') || (value.includes('?') && (value.includes('=') || value.includes('&'))))
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

export async function runServiceWorkerRegistration<R extends ServiceWorkerRegistrationLike>(
  deps: ServiceWorkerRegistrarDeps<R>,
): Promise<ServiceWorkerRegistrationOutcome> {
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;

  let registration: R | null | undefined;
  try {
    log('[SW] Registering Service Worker...');
    registration = await deps.register();
  } catch (error) {
    // 本物の登録失敗は、アンマウント後でも報告する（state は触らない）
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('[SW] Registration failed:', errorMessage);
    deps.reportError('register', error, { readyState: deps.readyState() });
    return 'failed';
  }

  if (!registration) {
    // 仕様上は成功時に ServiceWorkerRegistration が返る。返らないのは自動化環境などの
    // 非標準挙動で、扱う対象が無いので何もしない（エラー報告もしない）
    log('[SW] register() returned no registration; skipping update wiring');
    return 'no-registration';
  }

  if (deps.isDisposed()) {
    // 待機中にアンマウントされた。listener も interval も作らない
    return 'disposed';
  }

  const active = registration;
  deps.onRegistered(active);
  log('[SW] Service Worker registered:', active.scope);

  const handleUpdateError = (stage: 'initial-check' | 'scheduled-check') => (error: unknown) => {
    if (shouldIgnoreUpdateError(error, deps.isOnline())) {
      return;
    }
    logError(`[SW] ${stage === 'initial-check' ? 'Initial' : 'Scheduled'} update check failed:`, error);
    deps.reportError('update', error, { scope: active.scope, stage });
  };

  // Check for updates on initial load
  void active.update().catch(handleUpdateError('initial-check'));

  // Listen for updates
  active.addEventListener('updatefound', () => {
    const newWorker = active.installing;
    if (!newWorker) return;

    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && deps.hasController() && !deps.isDisposed()) {
        log('[SW] New version available!');
        deps.onUpdateAvailable();
      }
    });
  });

  // Check for updates every hour
  const intervalId = deps.setInterval(() => {
    void active.update().catch(handleUpdateError('scheduled-check'));
  }, SERVICE_WORKER_UPDATE_INTERVAL_MS);
  deps.onIntervalCreated(intervalId);

  return 'registered';
}
