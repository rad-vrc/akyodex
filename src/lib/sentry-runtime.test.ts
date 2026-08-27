import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  shouldApplyNextSentryBuildConfig,
  shouldInitializeNextServerSentry,
} from './sentry-runtime';

test('Next server Sentry is disabled for the Cloudflare Workers target', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', 'workers'), false);
  assert.equal(shouldInitializeNextServerSentry('edge', 'workers'), false);
});

test('Next server Sentry remains enabled for the Pages target', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', undefined), true);
  assert.equal(shouldInitializeNextServerSentry('edge', undefined), true);
});

test('Next Sentry build instrumentation is not applied to the Workers target', () => {
  assert.equal(shouldApplyNextSentryBuildConfig('workers', 'org', 'project', 'token'), false);
  assert.equal(shouldApplyNextSentryBuildConfig(undefined, 'org', 'project', 'token'), true);
  assert.equal(shouldApplyNextSentryBuildConfig(undefined, 'org', 'project', undefined), false);
});

test('instrumentation does not statically load the Node-oriented Next.js SDK', async () => {
  const source = await readFile(path.join(process.cwd(), 'instrumentation.ts'), 'utf8');

  assert.doesNotMatch(source, /^import .* from ['"]@sentry\/nextjs['"];?$/m);
});
