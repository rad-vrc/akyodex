/**
 * Sentry の environment 名と、合成トラフィック用の送信抑止。
 *
 * Lighthouse CI は本番と同じバンドルを本番と同じ条件で測りたいので、Sentry SDK の
 * 初期化は本番と同じに行う。しかし送られるイベントは絞り込み回線での「Web Vitals
 * degraded」ばかりで、週報の 8 割を占めるノイズになっていた（2026-09-05〜12 の
 * 462 件中 372 件）。DSN を外すと SDK が初期化されず計測条件が本番からずれるので、
 * 初期化はそのままにして送信段階で全部捨てる。
 *
 * ブラウザ（sentry-client-init.ts）と Node / Edge の設定ファイルの両方から使う。
 */

/** 合成トラフィックの環境名。ここに入っている環境からは Sentry に何も送らない */
export const SYNTHETIC_SENTRY_ENVIRONMENTS: ReadonlySet<string> = new Set(['lighthouse-ci']);

export interface SentryEnvironmentSource {
  /** NEXT_PUBLIC_SENTRY_ENVIRONMENT。各ワークフローが配備先ごとに設定する */
  environment?: string;
  /** NODE_ENV */
  nodeEnv?: string;
}

/** 配備先の環境名。未設定なら NODE_ENV、それも無ければ production */
export function resolveSentryEnvironment(source: SentryEnvironmentSource): string {
  return source.environment || source.nodeEnv || 'production';
}

export function isSyntheticSentryEnvironment(environment: string | undefined): boolean {
  return environment !== undefined && SYNTHETIC_SENTRY_ENVIRONMENTS.has(environment);
}

const dropEverything = (): null => null;

/**
 * 全種類の送信フックを「捨てる」に設定した部分オプション。
 * 合成トラフィックの環境でだけ init のオプションへ広げる。
 * ブラウザ／Node／Edge の各 Options 型はすべてこの 4 つのフックを持つ。
 */
export const DROP_ALL_TELEMETRY_HOOKS = Object.freeze({
  beforeSend: dropEverything,
  beforeSendTransaction: dropEverything,
  beforeSendMetric: dropEverything,
  beforeSendLog: dropEverything,
});

/** 合成トラフィックの環境なら送信抑止フック、それ以外なら空 */
export function telemetryHooksFor(environment: string): Partial<typeof DROP_ALL_TELEMETRY_HOOKS> {
  return isSyntheticSentryEnvironment(environment) ? DROP_ALL_TELEMETRY_HOOKS : {};
}
