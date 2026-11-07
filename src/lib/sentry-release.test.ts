import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SENTRY_RELEASE_ATTRIBUTE,
  normalizeSentryRelease,
  readBrowserSentryRelease,
  releaseFromWorkerVersion,
} from './sentry-release';
import { readWorkerSentryRelease } from './sentry-release-server';
import { workerSentryOptions } from './sentry-worker-options';

const COMMIT = '636be8fef64a182f553247ef311482f6fd17c335';

test('リリース名は git のコミット（40 桁の小文字の 16 進）だけを受け付ける', () => {
  assert.equal(normalizeSentryRelease(COMMIT), COMMIT);
  for (const value of [
    undefined,
    null,
    '',
    '636be8fe',
    COMMIT.toUpperCase(),
    `${COMMIT}0`,
    // @sentry/cloudflare の既定（Cloudflare の版の UUID）はリリース名にしない
    'a1dbf644-0ba2-467d-8b6e-216f1ecadef6',
    `"><script>alert(1)</script>`,
    123,
  ]) {
    assert.equal(normalizeSentryRelease(value), undefined, String(value));
  }
});

test('Worker の CF_VERSION_METADATA からは tag をリリース名にする（id は使わない）', () => {
  assert.equal(releaseFromWorkerVersion({ id: 'a1dbf644-0ba2-467d-8b6e-216f1ecadef6', tag: COMMIT }), COMMIT);
  assert.equal(releaseFromWorkerVersion({ id: 'a1dbf644-0ba2-467d-8b6e-216f1ecadef6' }), undefined);
  assert.equal(releaseFromWorkerVersion({ id: 'x', tag: 'PR staging' }), undefined);
  assert.equal(releaseFromWorkerVersion(undefined), undefined);
  assert.equal(releaseFromWorkerVersion('tag'), undefined);
});

test('ブラウザーは <html data-sentry-release> を読む', () => {
  assert.equal(SENTRY_RELEASE_ATTRIBUTE, 'data-sentry-release');
  const doc = (value?: string) => ({ documentElement: { dataset: value === undefined ? {} : { sentryRelease: value } } });
  assert.equal(readBrowserSentryRelease(doc(COMMIT)), COMMIT);
  assert.equal(readBrowserSentryRelease(doc()), undefined);
  assert.equal(readBrowserSentryRelease(doc('not-a-commit')), undefined);
  assert.equal(readBrowserSentryRelease(undefined), undefined);
});

test('サーバーは Cloudflare の文脈があるときだけ Worker の版の印を返す', () => {
  assert.equal(
    readWorkerSentryRelease(() => ({ env: { CF_VERSION_METADATA: { id: 'x', tag: COMMIT } } })),
    COMMIT
  );
  assert.equal(readWorkerSentryRelease(() => ({ env: {} })), undefined);
  // next dev・next start・Pages では getCloudflareContext が例外を投げる
  assert.equal(
    readWorkerSentryRelease(() => {
      throw new Error('getCloudflareContext has been called without having called initOpenNextCloudflareForDev');
    }),
    undefined
  );
});

test('Worker の Sentry の設定は、印があればリリース名を入れ、なければ SDK の既定に任せる', () => {
  const base = { SENTRY_DSN: 'https://public@example.invalid/1', SENTRY_ENVIRONMENT: 'staging' };
  assert.equal(workerSentryOptions({ ...base, CF_VERSION_METADATA: { id: 'x', tag: COMMIT } })?.release, COMMIT);
  const withoutTag = workerSentryOptions({ ...base, CF_VERSION_METADATA: { id: 'x' } });
  assert.ok(withoutTag);
  // release: undefined を置くと @sentry/cloudflare の既定（CF_VERSION_METADATA.id）まで消えるので、キーごと置かない
  assert.equal(Object.hasOwn(withoutTag, 'release'), false);
  assert.equal(workerSentryOptions({ CF_VERSION_METADATA: { tag: COMMIT } }), undefined);
});
