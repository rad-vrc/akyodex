import assert from 'node:assert/strict';
import test from 'node:test';
import { withWorkerVersionHeaders } from './worker-version-headers';
import * as workerVersionHeadersModule from './worker-version-headers';

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
});

test('withWorkerVersionHeaders omits an unavailable version tag', () => {
  const result = withWorkerVersionHeaders(new Response(null), { id: 'version-id' });

  assert.equal(result.headers.get('x-akyodex-worker-version'), 'version-id');
  assert.equal(result.headers.has('x-akyodex-worker-tag'), false);
});

test('Workers staging responses prevent search indexing without affecting production', () => {
  const withWorkerResponseHeaders = (
    workerVersionHeadersModule as {
      withWorkerResponseHeaders?: (
        response: Response,
        version: { id: string; tag?: string },
        requestUrl: string
      ) => Response;
    }
  ).withWorkerResponseHeaders;
  assert.equal(typeof withWorkerResponseHeaders, 'function');
  if (!withWorkerResponseHeaders) return;

  const stagingResponse = withWorkerResponseHeaders(
    new Response('staging'),
    { id: 'version-1' },
    'https://staging.akyodex.com/zukan'
  );
  assert.equal(
    stagingResponse.headers.get('X-Robots-Tag'),
    'noindex, nofollow, noarchive'
  );

  const productionResponse = withWorkerResponseHeaders(
    new Response('production'),
    { id: 'version-1' },
    'https://akyodex.com/zukan'
  );
  assert.equal(productionResponse.headers.get('X-Robots-Tag'), null);
});
