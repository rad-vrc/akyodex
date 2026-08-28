import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  'production';

if (dsn) {
  Sentry.init({
    dsn,
    enableMetrics: true,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    sendDefaultPii: false,
    environment,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
