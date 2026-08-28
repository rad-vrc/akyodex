interface WorkerVersionIdentity {
  id: string;
  tag?: string;
}

function createWorkerHeaders(
  response: Response,
  version: WorkerVersionIdentity
): Headers {
  const headers = new Headers(response.headers);
  headers.set('X-Akyodex-Worker-Version', version.id);

  if (version.tag) {
    headers.set('X-Akyodex-Worker-Tag', version.tag);
  }

  return headers;
}

export function withWorkerVersionHeaders(
  response: Response,
  version: WorkerVersionIdentity
): Response {
  const headers = createWorkerHeaders(response, version);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withWorkerResponseHeaders(
  response: Response,
  version: WorkerVersionIdentity,
  deploymentEnvironment: string
): Response {
  const headers = createWorkerHeaders(response, version);
  if (deploymentEnvironment !== 'production') {
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
