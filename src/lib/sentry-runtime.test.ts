import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { shouldInitializeNextServerSentry } from './sentry-runtime';

test('Next server Sentry is disabled for the Cloudflare Workers target', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', 'workers'), false);
  assert.equal(shouldInitializeNextServerSentry('edge', 'workers'), false);
});

test('Next server Sentry remains enabled for the Pages target', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', undefined), true);
  assert.equal(shouldInitializeNextServerSentry('edge', undefined), true);
});

test('instrumentation does not statically load the Node-oriented Next.js SDK', async () => {
  const source = await readFile(path.join(process.cwd(), 'instrumentation.ts'), 'utf8');

  assert.doesNotMatch(source, /^import .* from ['"]@sentry\/nextjs['"];?$/m);
});
