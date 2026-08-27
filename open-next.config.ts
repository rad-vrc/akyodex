import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
import { withRegionalCache } from '@opennextjs/cloudflare/overrides/incremental-cache/regional-cache';
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue';
import d1NextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache';
import kvNextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache';

const isWorkersTarget = process.env.CLOUDFLARE_DEPLOY_TARGET === 'workers';

const cloudflareConfig = defineCloudflareConfig({
  incrementalCache: isWorkersTarget
    ? withRegionalCache(r2IncrementalCache, { mode: 'long-lived' })
    : r2IncrementalCache,
  tagCache: isWorkersTarget ? d1NextTagCache : kvNextTagCache,
  // Pages cannot host the OpenNext Durable Object queue. Keep its current fallback
  // while the independently deployed Workers target uses the production queue.
  queue: isWorkersTarget ? doQueue : 'direct',
  // Enable cache interception to reduce origin hits on cached responses.
  enableCacheInterception: true,
});

const openNextConfig = {
  ...cloudflareConfig,
  // Prevent recursive build calls: OpenNext should run Next.js build directly.
  buildCommand: 'npm run next:build:opennext',
};

export default openNextConfig;
