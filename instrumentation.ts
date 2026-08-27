import * as Sentry from '@sentry/nextjs';
import { shouldInitializeNextServerSentry } from './src/lib/sentry-runtime';

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

export const onRequestError = Sentry.captureRequestError;
