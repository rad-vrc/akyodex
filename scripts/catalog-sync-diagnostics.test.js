const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { checkCatalogR2 } = require('./check-catalog-r2');
const { diagnostic } = require('./catalog-sync-diagnostic');
const { revalidateCatalog } = require('./revalidate-catalog');

const r2Env = {
  R2_BUCKET: 'akyo-images', CLOUDFLARE_ACCOUNT_ID: 'account-secret',
  AWS_ACCESS_KEY_ID: 'access-secret', AWS_SECRET_ACCESS_KEY: 'signing-secret',
  AWS_SESSION_TOKEN: 'session-secret',
};
const cacheEnv = { SITE_URL: 'https://example.com', REVALIDATE_SECRET: 'revalidate-secret-value' };
const fullResult = {
  success: true, kvUpdated: true,
  kvUpdateDetails: { ja: true, en: true, ko: true, metadata: true },
  paths: ['/', '/en', '/ko', '/zukan'], tags: ['akyo-data', 'akyo-data-ja', 'akyo-data-en', 'akyo-data-ko'],
};
function capture() {
  const lines = [];
  return { lines, log: { log: (line) => lines.push(line), error: (line) => lines.push(line) } };
}

test('diagnostics mask credentials, URLs and line breaks before writing logs', () => {
  const result = diagnostic('Authorization: Bearer unexpected-token\naccess-secret https://example.com/?token=sensitive\nx-revalidate-secret: another-secret', ['access-secret']);
  assert.doesNotMatch(result, /unexpected-token|access-secret|sensitive|another-secret|\n/);
  assert.match(result, /authorization=\[redacted\]/);
});

test('R2 check retries and reports a sanitized AWS error without logging the bucket listing', async () => {
  const output = capture(), calls = [], waits = [];
  await checkCatalogR2({ env: r2Env, log: output.log, sleep: async (ms) => waits.push(ms),
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return calls.length === 1
        ? { status: 254, stderr: 'An error occurred (AccessDenied) when calling ListObjectsV2: signing-secret https://account-secret.r2.cloudflarestorage.com/?token=session-secret' }
        : { status: 0, stdout: 'private bucket listing' };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'aws');
  assert.deepEqual(calls[0].args, ['s3', 'ls', 's3://akyo-images/', '--endpoint-url', 'https://account-secret.r2.cloudflarestorage.com']);
  assert.equal(calls[0].options.timeout, 30000);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'ignore', 'pipe']);
  assert.deepEqual(waits, [5000]);
  assert.match(output.lines[0], /AccessDenied/);
  assert.match(output.lines[0], /status 254/);
  assert.doesNotMatch(output.lines.join(' '), /signing-secret|session-secret|account-secret|private bucket listing/);
});

test('R2 access failure remains a failure after three attempts, including timeouts', async () => {
  const output = capture(), waits = [];
  let calls = 0;
  await assert.rejects(checkCatalogR2({ env: r2Env, log: output.log, sleep: async (ms) => waits.push(ms),
    run: () => { calls++; return { status: null, error: { code: 'ETIMEDOUT', message: 'request timed out' } }; },
  }), /failed after 3 attempts/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 10000]);
  assert.equal(output.lines.filter((line) => /ETIMEDOUT/.test(line)).length, 3);
});

test('R2 access never starts when credentials are missing', async () => {
  let calls = 0;
  await assert.rejects(checkCatalogR2({ env: { ...r2Env, AWS_SECRET_ACCESS_KEY: '' }, run: () => { calls++; } }), /not configured/);
  assert.equal(calls, 0);
});

test('revalidation sends the existing payload and only succeeds when KV is updated', async () => {
  const output = capture(), calls = [];
  await revalidateCatalog({ env: cacheEnv, log: output.log, request: async (url, options) => {
    calls.push({ url, options });
    return Response.json(fullResult);
  } });
  assert.equal(calls[0].url, 'https://example.com/api/revalidate');
  assert.equal(calls[0].options.headers['x-revalidate-secret'], cacheEnv.REVALIDATE_SECRET);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    paths: ['/', '/en', '/ko', '/zukan'], tags: ['akyo-data', 'akyo-data-ja', 'akyo-data-en', 'akyo-data-ko'], updateKV: true,
  });
  assert.doesNotMatch(output.lines.join(' '), /revalidate-secret-value/);
});

test('revalidation retries HTTP errors and incomplete success responses without exposing secrets', async () => {
  const output = capture(), waits = [];
  let calls = 0;
  await revalidateCatalog({ env: cacheEnv, log: output.log, sleep: async (ms) => waits.push(ms), request: async () => {
    calls++;
    if (calls === 1) return Response.json({ success: false, error: 'bad revalidate-secret-value' }, { status: 500 });
    if (calls === 2) return Response.json({ ...fullResult, kvUpdated: false, kvError: 'KV update incomplete' });
    return Response.json(fullResult);
  } });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 10000]);
  assert.match(output.lines[0], /HTTP 500/);
  assert.match(output.lines[1], /KV update incomplete/);
  assert.doesNotMatch(output.lines.join(' '), /revalidate-secret-value/);
});

test('revalidation rejects a partial Korean update or missing revalidation paths and tags', async () => {
  for (const partial of [
    { ...fullResult, kvUpdateDetails: { ...fullResult.kvUpdateDetails, ko: false } },
    { ...fullResult, paths: ['/'] },
    { ...fullResult, tags: ['akyo-data'] },
  ]) {
    const output = capture();
    let calls = 0;
    await assert.rejects(revalidateCatalog({ env: cacheEnv, log: output.log, sleep: async () => {}, request: async () => {
      calls++;
      return Response.json(partial);
    } }), /failed after 3 attempts/);
    assert.equal(calls, 3);
    assert.match(output.lines[0], /ko=false|paths=false|tags=false/);
  }
});

test('revalidation fails after HTTP, malformed and network failures', async () => {
  const output = capture();
  let calls = 0;
  await assert.rejects(revalidateCatalog({ env: cacheEnv, log: output.log, sleep: async () => {}, request: async () => {
    calls++;
    if (calls === 1) return new Response('not json', { status: 503 });
    if (calls === 2) return new Response('not json', { status: 200 });
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  } }), /failed after 3 attempts/);
  assert.equal(calls, 3);
  assert.match(output.lines[0], /HTTP 503/);
  assert.match(output.lines[1], /HTTP 200/);
  assert.match(output.lines[2], /ECONNRESET/);
});

test('revalidation refuses missing secrets before calling the service', async () => {
  let calls = 0;
  await assert.rejects(revalidateCatalog({ env: { ...cacheEnv, REVALIDATE_SECRET: '' }, request: () => { calls++; } }), /not configured/);
  assert.equal(calls, 0);
});

test('script entry points exit nonzero on missing secrets', () => {
  for (const script of ['check-catalog-r2.js', 'revalidate-catalog.js']) {
    const result = spawnSync(process.execPath, [join(__dirname, script)], {
      encoding: 'utf8', env: { ...process.env, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', REVALIDATE_SECRET: '' },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not configured/);
  }
});

test('revalidation CLI sends a real request and accepts the actual response shape', async () => {
  let received;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { path: req.url, secret: req.headers['x-revalidate-secret'], body: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fullResult));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const child = spawn(process.execPath, [join(__dirname, 'revalidate-catalog.js')], {
      env: { ...process.env, SITE_URL: `http://127.0.0.1:${server.address().port}`, REVALIDATE_SECRET: cacheEnv.REVALIDATE_SECRET },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, output);
    assert.equal(received.path, '/api/revalidate');
    assert.equal(received.secret, cacheEnv.REVALIDATE_SECRET);
    assert.equal(received.body.updateKV, true);
    assert.doesNotMatch(output, /revalidate-secret-value/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('the production sync uses both checked scripts and cannot report cache failure as success', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/sync-json-data.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /node scripts\/check-catalog-r2\.js/);
  assert.match(workflow, /run: node scripts\/revalidate-catalog\.js/);
  assert.doesNotMatch(workflow, /aws s3 ls[^\n]*2>&1/);
  assert.doesNotMatch(workflow, /ISR revalidation failed \(HTTP[^\n]*\)"\s+echo/);
});
