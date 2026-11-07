import { withSentry } from '@sentry/cloudflare';
import openNextWorker from './.open-next/worker.js';
import { withWorkerResponseHeaders } from './src/lib/worker-version-headers';
import { withCatalogWorkerTiming } from './src/lib/catalog-diagnostics';
import { workerSentryOptions } from './src/lib/sentry-worker-options';

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
    const response = await withCatalogWorkerTiming(request, () =>
      openNextWorker.fetch(request, env, ctx)
    );
    return withWorkerResponseHeaders(
      response,
      env.CF_VERSION_METADATA,
      env.AKYODEX_DEPLOYMENT_ENVIRONMENT
    );
  },
} satisfies CloudflareWorkerHandler<WorkersRuntimeEnv>;

// リリース名は Worker の版の印（git のコミット）。ブラウザーと同じ名前にする（src/lib/sentry-worker-options.ts）
export default withSentry<WorkersRuntimeEnv>((env) => workerSentryOptions(env), handler);
