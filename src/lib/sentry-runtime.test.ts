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

test('Next server Sentry is disabled for the Cloudflare Pages target', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', 'pages'), false);
  assert.equal(shouldInitializeNextServerSentry('edge', 'pages'), false);
});

test('Next server Sentry remains enabled outside Cloudflare', () => {
  assert.equal(shouldInitializeNextServerSentry('nodejs', undefined), true);
  assert.equal(shouldInitializeNextServerSentry('edge', undefined), true);
});

test('Next Sentry build instrumentation is not applied to Cloudflare targets', () => {
  assert.equal(shouldApplyNextSentryBuildConfig('workers', 'org', 'project', 'token'), false);
  assert.equal(shouldApplyNextSentryBuildConfig('pages', 'org', 'project', 'token'), false);
  assert.equal(shouldApplyNextSentryBuildConfig(undefined, 'org', 'project', 'token'), true);
  assert.equal(shouldApplyNextSentryBuildConfig(undefined, 'org', 'project', undefined), false);
});

test('the Pages build declares its Cloudflare target explicitly', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as { scripts?: Record<string, string> };

  assert.match(
    packageJson.scripts?.build ?? '',
    /cross-env CLOUDFLARE_DEPLOY_TARGET=pages opennextjs-cloudflare build/
  );
});

test('Next.js inlines the non-secret Cloudflare target into server bundles', async () => {
  const source = await readFile(path.join(process.cwd(), 'next.config.ts'), 'utf8');

  assert.match(
    source,
    /CLOUDFLARE_DEPLOY_TARGET:\s*process\.env\.CLOUDFLARE_DEPLOY_TARGET\s*\|\|\s*['"]{2}/
  );
});

test('instrumentation does not statically load the Node-oriented Next.js SDK', async () => {
  const source = await readFile(path.join(process.cwd(), 'instrumentation.ts'), 'utf8');

  assert.doesNotMatch(source, /^import .* from ['"]@sentry\/nextjs['"];?$/m);
});
