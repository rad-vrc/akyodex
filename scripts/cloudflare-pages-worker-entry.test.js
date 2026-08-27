const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const entrySourcePath = path.join(
  __dirname,
  'cloudflare-pages-worker-entry.mjs'
);

async function loadWorkerEntry(t) {
  const fixtureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'akyodex-pages-entry-')
  );
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(fixtureDir, 'package.json'),
    JSON.stringify({ type: 'module' })
  );
  fs.copyFileSync(
    entrySourcePath,
    path.join(fixtureDir, '_worker.js')
  );
  fs.writeFileSync(
    path.join(fixtureDir, 'worker.js'),
    [
      'export default {',
      '  async fetch(request) {',
      '    return new Response(`delegated:${request.method}`, {',
      '      headers: { "X-Delegated": "true" },',
      '    });',
      '  },',
      '};',
    ].join('\n')
  );

  const moduleUrl = pathToFileURL(path.join(fixtureDir, '_worker.js'));
  return import(moduleUrl.href);
}

test('Pages preview blocks mutating methods before OpenNext handles them', async (t) => {
  const entry = await loadWorkerEntry(t);
  const response = await entry.default.fetch(
    new Request('https://preview.example/api/admin/login', { method: 'POST' }),
    { PAGES_PREVIEW_READ_ONLY: 'true' },
    {}
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-delegated'), null);
  assert.equal(
    response.headers.get('x-robots-tag'),
    'noindex, nofollow, noarchive'
  );
});

test('Pages preview delegates safe methods and adds noindex headers', async (t) => {
  const entry = await loadWorkerEntry(t);
  const response = await entry.default.fetch(
    new Request('https://preview.example/zukan'),
    { PAGES_PREVIEW_READ_ONLY: 'true' },
    {}
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'delegated:GET');
  assert.equal(response.headers.get('x-delegated'), 'true');
  assert.equal(
    response.headers.get('x-robots-tag'),
    'noindex, nofollow, noarchive'
  );
});

test('Pages production delegates mutating methods without preview headers', async (t) => {
  const entry = await loadWorkerEntry(t);
  const response = await entry.default.fetch(
    new Request('https://akyodex.com/api/admin/login', { method: 'POST' }),
    { PAGES_PREVIEW_READ_ONLY: 'false' },
    {}
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'delegated:POST');
  assert.equal(response.headers.get('x-delegated'), 'true');
  assert.equal(response.headers.get('x-robots-tag'), null);
});
