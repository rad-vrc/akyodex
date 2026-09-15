import * as Sentry from '@sentry/nextjs';

import { resolveSentryEnvironment, telemetryOptionsFor } from './src/lib/sentry-environment';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
// ブラウザ側と同じ環境名にする。Lighthouse CI は Node サーバーを NODE_ENV=production で
// 起動するので、NODE_ENV だけを見ると CI のサーバー側計測が production として混ざる
const environment = resolveSentryEnvironment({
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  nodeEnv: process.env.NODE_ENV,
});

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    sendDefaultPii: false,
    environment,
    ...telemetryOptionsFor(environment),
  });
}
