import { withSentry } from '@sentry/cloudflare';
import openNextWorker from './.open-next/worker.js';
import { withWorkerResponseHeaders } from './src/lib/worker-version-headers';

export { DOQueueHandler } from './.open-next/worker.js';

interface WorkersRuntimeEnv extends CloudflareWorkerBindings {
  SENTRY_DSN?: string;
}

interface CloudflareWorkerHandler<Env> {
  fetch(
    request: Request,
    env: Env,
    ctx: CloudflareExecutionContext
  ): Response | Promise<Response>;
}

const handler = {
  async fetch(request, env, ctx) {
    const response = await openNextWorker.fetch(request, env, ctx);
    return withWorkerResponseHeaders(
      response,
      env.CF_VERSION_METADATA,
      env.AKYODEX_DEPLOYMENT_ENVIRONMENT
    );
  },
} satisfies CloudflareWorkerHandler<WorkersRuntimeEnv>;

export default withSentry<WorkersRuntimeEnv>(
  (env) =>
    env.SENTRY_DSN
      ? {
          dsn: env.SENTRY_DSN,
          environment: env.SENTRY_ENVIRONMENT,
          sendDefaultPii: false,
          tracesSampleRate: 0.1,
        }
      : undefined,
  handler
);
