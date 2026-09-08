const HOSTS = {
  page: new Set(['vrchat.com']),
  image: new Set(['api.vrchat.cloud', 'files.vrchat.cloud', 'images.vrchat.cloud']),
};
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

type FetchOptions = Pick<RequestInit, 'headers' | 'signal'> & {
  next?: { revalidate: number };
};

/** Validate each destination before fetching; checking response.url would be too late. */
export async function fetchVrchatResource(
  url: string,
  kind: keyof typeof HOSTS,
  options: FetchOptions,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  let destination = new URL(url);
  for (let redirects = 0; ; redirects++) {
    if (
      destination.protocol !== 'https:' ||
      !HOSTS[kind].has(destination.hostname) ||
      destination.username || destination.password || destination.port
    ) {
      throw new Error('Untrusted VRChat resource destination');
    }
    const response = await fetchFn(destination.href, { ...options, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location) throw new Error('VRChat redirect missing Location');
    if (redirects >= MAX_REDIRECTS) throw new Error('VRChat redirect limit exceeded');
    destination = new URL(location, destination);
  }
}
