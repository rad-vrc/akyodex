import { getCloudflareContext } from '@opennextjs/cloudflare';

import { releaseFromWorkerVersion } from './sentry-release';

type CloudflareContextReader = () => { env: unknown };

/**
 * Worker で描くときだけ、その Worker の版の印（git のコミット）を Sentry のリリース名として返す。
 * next dev・next start（Lighthouse CI）・Pages など Cloudflare の文脈がないときは undefined
 * （getCloudflareContext が例外を投げる）。
 */
export function readWorkerSentryRelease(
  getContext: CloudflareContextReader = getCloudflareContext
): string | undefined {
  try {
    const { env } = getContext();
    return releaseFromWorkerVersion((env as { CF_VERSION_METADATA?: unknown })?.CF_VERSION_METADATA);
  } catch {
    return undefined;
  }
}
