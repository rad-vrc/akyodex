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

export function withWorkerResponseHeaders(
  response: Response,
  version: WorkerVersionIdentity,
  requestUrl: string
): Response {
  const versionedResponse = withWorkerVersionHeaders(response, version);
  if (new URL(requestUrl).hostname !== 'staging.akyodex.com') {
    return versionedResponse;
  }

  const headers = new Headers(versionedResponse.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  return new Response(versionedResponse.body, {
    status: versionedResponse.status,
    statusText: versionedResponse.statusText,
    headers,
  });
}
