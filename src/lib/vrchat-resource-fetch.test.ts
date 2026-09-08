import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchVrchatResource } from './vrchat-resource-fetch';

const page = 'https://vrchat.com/home/avatar/avtr_test';
const image = 'https://api.vrchat.cloud/api/1/file/file_test/1/file';

test('keeps legitimate image redirects, fetch options and a shared abort signal', async () => {
  const calls: string[] = [];
  const signal = new AbortController().signal;
  let cancelled = false;
  const fetchFn: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.signal, signal);
    assert.deepEqual(init?.headers, { Accept: 'image/*' });
    assert.deepEqual((init as { next?: unknown }).next, { revalidate: 3600 });
    return calls.length === 1
      ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
          status: 302, headers: { Location: 'https://files.vrchat.cloud/image.png' },
        })
      : new Response('image');
  };
  const response = await fetchVrchatResource(image, 'image', {
    signal, headers: { Accept: 'image/*' }, next: { revalidate: 3600 },
  }, fetchFn);
  assert.equal(await response.text(), 'image');
  assert.equal(cancelled, true);
  assert.deepEqual(calls, [image, 'https://files.vrchat.cloud/image.png']);
});

test('resolves relative page redirects', async () => {
  const calls: string[] = [];
  const response = await fetchVrchatResource(page, 'page', {}, async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? new Response(null, { status: 307, headers: { Location: '/home/avatar/avtr_other' } })
      : new Response('page');
  });
  assert.equal(await response.text(), 'page');
  assert.deepEqual(calls, [page, 'https://vrchat.com/home/avatar/avtr_other']);
});

for (const target of [
  'http://vrchat.com/', 'https://vrchat.com.evil.example/', 'https://127.0.0.1/',
  'https://[::1]/', 'https://169.254.169.254/', 'https://user:pass@vrchat.com/',
  'https://vrchat.com:8443/', '//evil.example/', 'file:///etc/passwd',
]) {
  test(`rejects an untrusted redirect before requesting it: ${target}`, async () => {
    let calls = 0;
    await assert.rejects(fetchVrchatResource(page, 'page', {}, async () => {
      calls++;
      return new Response(null, { status: 302, headers: { Location: target } });
    }), /VRChat/);
    assert.equal(calls, 1);
  });
}

test('checks initial image URLs and every later redirect, not only the first hop', async () => {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 302, headers: {
      Location: calls === 1 ? 'https://files.vrchat.cloud/image.png' : 'https://evil.example/',
    } });
  };
  await assert.rejects(fetchVrchatResource('https://evil.example/', 'image', {}, fetchFn), /VRChat/);
  assert.equal(calls, 0);
  await assert.rejects(fetchVrchatResource(image, 'image', {}, fetchFn), /VRChat/);
  assert.equal(calls, 2);
});

test('bounds redirect loops and rejects missing Location', async () => {
  let calls = 0;
  await assert.rejects(fetchVrchatResource(page, 'page', {}, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: page } });
  }), /redirect limit/);
  assert.equal(calls, 4);
  await assert.rejects(fetchVrchatResource(page, 'page', {}, async () => new Response(null, { status: 302 })), /Location/);
});

test('returns upstream errors unchanged and propagates fetch failure', async () => {
  const response = await fetchVrchatResource(page, 'page', {}, async () => new Response('missing', { status: 404 }));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'missing');
  const error = new DOMException('aborted', 'AbortError');
  await assert.rejects(fetchVrchatResource(page, 'page', {}, async () => { throw error; }), error);
});
