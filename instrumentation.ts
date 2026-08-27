import { shouldInitializeNextServerSentry } from './src/lib/sentry-runtime';

type CaptureRequestError = typeof import('@sentry/nextjs').captureRequestError;

export async function register() {
  if (!shouldInitializeNextServerSentry(process.env.NEXT_RUNTIME, process.env.CLOUDFLARE_DEPLOY_TARGET)) {
    return;
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(...args: Parameters<CaptureRequestError>): Promise<void> {
  if (!shouldInitializeNextServerSentry(process.env.NEXT_RUNTIME, process.env.CLOUDFLARE_DEPLOY_TARGET)) {
    return;
  }

  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
