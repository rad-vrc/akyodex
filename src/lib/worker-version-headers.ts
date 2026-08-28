interface WorkerVersionIdentity {
  id: string;
  tag?: string;
}

function normalizeServerTimingDescription(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
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

  const observableVersion = normalizeServerTimingDescription(
    version.tag || version.id
  );
  headers.append(
    'Server-Timing',
    `akyodex-version;desc="${observableVersion}"`
  );

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
