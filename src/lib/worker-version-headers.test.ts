import assert from 'node:assert/strict';
import test from 'node:test';
import { withWorkerVersionHeaders } from './worker-version-headers';

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
