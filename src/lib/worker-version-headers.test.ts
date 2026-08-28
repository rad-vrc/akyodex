import assert from 'node:assert/strict';
import test from 'node:test';
import {
  withWorkerResponseHeaders,
  withWorkerVersionHeaders,
} from './worker-version-headers';

test('withWorkerVersionHeaders preserves the response and exposes deployment identity', async () => {
  const response = new Response('ok', {
    status: 202,
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Content-Type': 'text/plain',
    },
  });

  const result = withWorkerVersionHeaders(response, {
    id: 'version-id',
    tag: 'git-sha',
  });

  assert.equal(result.status, 202);
  assert.equal(await result.text(), 'ok');
  assert.equal(result.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(result.headers.get('x-akyodex-worker-version'), 'version-id');
  assert.equal(result.headers.get('x-akyodex-worker-tag'), 'git-sha');
  assert.match(
    result.headers.get('server-timing') ?? '',
    /akyodex-version;desc="git-sha"/,
  );
});

test('withWorkerVersionHeaders omits an unavailable version tag', () => {
  const result = withWorkerVersionHeaders(new Response(null), { id: 'version-id' });

  assert.equal(result.headers.get('x-akyodex-worker-version'), 'version-id');
  assert.equal(result.headers.has('x-akyodex-worker-tag'), false);
  assert.match(
    result.headers.get('server-timing') ?? '',
    /akyodex-version;desc="version-id"/,
  );
});

test('Workers staging responses prevent search indexing without affecting production', () => {
  const stagingResponse = withWorkerResponseHeaders(
    new Response('staging'),
    { id: 'version-1' },
    'staging'
  );
  assert.equal(
    stagingResponse.headers.get('X-Robots-Tag'),
    'noindex, nofollow, noarchive'
  );

  const productionResponse = withWorkerResponseHeaders(
    new Response('production'),
    { id: 'version-1' },
    'production'
  );
  assert.equal(productionResponse.headers.get('X-Robots-Tag'), null);
});

test('unknown deployment environments fail closed with noindex', () => {
  const response = withWorkerResponseHeaders(
    new Response('unknown'),
    { id: 'version-1' },
    'preview-2'
  );
  assert.equal(
    response.headers.get('X-Robots-Tag'),
    'noindex, nofollow, noarchive'
  );
});
