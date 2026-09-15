import * as Sentry from '@sentry/nextjs';

import { resolveSentryEnvironment, telemetryOptionsFor } from './src/lib/sentry-environment';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
// sentry.server.config.ts と同じ理由でブラウザ側と環境名を揃える
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
