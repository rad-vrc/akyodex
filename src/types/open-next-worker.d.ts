declare module '*.open-next/worker.js' {
  type OpenNextFetchHandler = (
    request: Request,
    env: CloudflareWorkerBindings,
    ctx: CloudflareExecutionContext
  ) => Response | Promise<Response>;

  const openNextWorker: {
    fetch: OpenNextFetchHandler;
  };

  export class DOQueueHandler extends DurableObject<CloudflareWorkerBindings> {}

  export default openNextWorker;
}
