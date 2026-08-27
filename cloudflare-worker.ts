import openNextWorker from './.open-next/worker.js';

export { DOQueueHandler } from './.open-next/worker.js';

interface CloudflareWorkerHandler {
  fetch(
    request: Request,
    env: CloudflareWorkerBindings,
    ctx: CloudflareExecutionContext
  ): Response | Promise<Response>;
}

export default {
  fetch: openNextWorker.fetch,
} satisfies CloudflareWorkerHandler;
