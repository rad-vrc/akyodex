import { releaseFromWorkerVersion } from './sentry-release';

export interface WorkerSentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: unknown;
}

/**
 * Worker（cloudflare-worker.ts の withSentry）に渡す Sentry の設定。DSN がなければ undefined（初期化しない）。
 *
 * リリース名は Worker の版の印（git のコミット）にして、ブラウザーと同じ名前にそろえる（sentry-release.ts）。
 * 印がないときはキーを置かず、@sentry/cloudflare の既定（CF_VERSION_METADATA.id = Cloudflare の版の UUID）に任せる。
 * release: undefined を置くと、SDK の既定まで消してしまう（SDK は既定の上に渡した設定を重ねる）。
 */
export function workerSentryOptions(env: WorkerSentryEnv) {
  if (!env.SENTRY_DSN) {
    return undefined;
  }
  const release = releaseFromWorkerVersion(env.CF_VERSION_METADATA);
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    ...(release ? { release } : {}),
  };
}
