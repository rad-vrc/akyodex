interface WorkerVersionIdentity {
  id: string;
  tag?: string;
}

export function withWorkerVersionHeaders(
  response: Response,
  version: WorkerVersionIdentity
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Akyodex-Worker-Version', version.id);

  if (version.tag) {
    headers.set('X-Akyodex-Worker-Tag', version.tag);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
