import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface WorkersWranglerConfig {
  vars?: Record<string, string>;
}

test('Workers runtime selects the Workers OpenNext cache adapters', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;

  assert.equal(config.vars?.CLOUDFLARE_DEPLOY_TARGET, 'workers');
});
