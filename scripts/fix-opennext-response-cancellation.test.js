const assert = require('node:assert/strict');
const { readFile, writeFile, mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { pipeToNodeResponse } = require('next/dist/server/pipe-readable');
const { patchSource, patchFile } = require('./fix-opennext-response-cancellation');

const upstreamPath = require.resolve('@opennextjs/aws/overrides/wrappers/cloudflare-node.js');

async function fixture(t, { status = 200, signal, initialChunk = '<html>' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opennext-cancel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'wrapper.mjs');
  const source = patchSource(await readFile(upstreamPath, 'utf8'));
  await writeFile(file, source);
  const { default: adapter } = await import(pathToFileURL(file).href);
  const { OpenNextNodeResponse } = await import('@opennextjs/aws/http/index.js');
  const promises = [];
  let nodeResponse;
  let streamCreator;
  let producer;
  let producerCanceled = false;
  const handler = await adapter.wrapper(async (_event, context) => {
    streamCreator = context.streamCreator;
    nodeResponse = new OpenNextNodeResponse(() => {}, async () => {}, streamCreator, undefined, status);
    t.after(() => nodeResponse.destroy());
    const body = new ReadableStream({
      start(controller) { producer = controller; controller.enqueue(Buffer.from(initialChunk)); },
      cancel() { producerCanceled = true; },
    });
    await pipeToNodeResponse(body, nodeResponse);
  }, { convertFrom: async () => ({}) });
  const response = await handler(new Request('https://local.invalid/zukan'), {}, {
    waitUntil(promise) { promises.push(promise); },
  }, signal);
  return {
    response, nodeResponse, streamCreator, producer,
    get producerCanceled() { return producerCanceled; },
    settled: () => Promise.all(promises),
  };
}

async function bounded(promise) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('HTML render remained pending')), 500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test('early body cancellation aborts the actual OpenNext/Next rendering pipeline', async (t) => {
  const original = new AbortController();
  const result = await fixture(t, { signal: original.signal });
  await result.response.body.cancel();
  assert.equal(result.streamCreator.abortSignal.aborted, true);
  assert.equal(original.signal.aborted, false, 'do not abort the caller-owned controller');
  await bounded(result.settled());
  assert.equal(result.nodeResponse.destroyed, true);
  assert.equal(result.producerCanceled, true);
});

test('cancellation after consuming a chunk also settles rendering', async (t) => {
  const result = await fixture(t);
  const reader = result.response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), '<html>');
  await reader.cancel();
  assert.equal(result.streamCreator.abortSignal.aborted, true);
  await bounded(result.settled());
  assert.equal(result.producerCanceled, true);
});

test('normal HTML still streams before the producer finishes', async (t) => {
  const result = await fixture(t);
  const reader = result.response.body.getReader();
  assert.equal(new TextDecoder().decode((await bounded(reader.read())).value), '<html>');
  assert.equal(result.streamCreator.abortSignal?.aborted ?? false, false);
  result.producer.enqueue(Buffer.from('</html>'));
  result.producer.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), '</html>');
  assert.equal((await reader.read()).done, true);
  await bounded(result.settled());
  assert.equal(result.producerCanceled, false);
});

test('the original request abort signal still stops rendering', async (t) => {
  const original = new AbortController();
  const result = await fixture(t, { signal: original.signal });
  original.abort();
  await bounded(result.settled());
  assert.equal(result.nodeResponse.destroyed, true);
  assert.equal(result.producerCanceled, true);
});

for (const status of [204, 205, 304]) {
  test(`null-body status ${status} remains null and rendering finishes`, async (t) => {
    const result = await fixture(t, { status });
    assert.equal(result.response.status, status);
    assert.equal(result.response.body, null);
    result.producer.close();
    await bounded(result.settled());
  });
}

test('patch application is idempotent', async () => {
  const original = await readFile(upstreamPath, 'utf8');
  const patched = patchSource(original);
  assert.equal(patchSource(patched), patched);
});

test('cancelling one request does not abort another request', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  await first.response.body.cancel();
  await bounded(first.settled());
  assert.equal(second.streamCreator.abortSignal.aborted, false);
  second.producer.enqueue(Buffer.from('</html>'));
  second.producer.close();
  assert.equal(await second.response.text(), '<html></html>');
  await bounded(second.settled());
  assert.equal(second.producerCanceled, false);
});

test('changed upstream code is rejected rather than silently left unpatched', async () => {
  const original = await readFile(upstreamPath, 'utf8');
  assert.throws(() => patchSource(`${original}\n// upstream changed\n`), /review.*upstream/i);
});

test('unknown or partially patched files are not overwritten', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opennext-cancel-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'wrapper.mjs');
  const original = await readFile(upstreamPath, 'utf8');
  const changed = `${patchSource(original)}\n// additional upstream change\n`;
  await writeFile(file, changed);
  assert.throws(() => patchFile(file), /review.*upstream/i);
  assert.equal(await readFile(file, 'utf8'), changed);
});

test('the patched dependency can be checked repeatedly on disk', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opennext-cancel-repeat-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'wrapper.mjs');
  const original = await readFile(upstreamPath, 'utf8');
  await writeFile(file, original);
  patchFile(file);
  const patched = await readFile(file, 'utf8');
  assert.equal(patchFile(file), false);
  assert.equal(await readFile(file, 'utf8'), patched);
});

test('all Cloudflare builds apply the fix before starting OpenNext', async () => {
  const { scripts } = JSON.parse(await readFile(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const name of ['build', 'build:workers', 'build:workers:production']) {
    assert.ok(scripts[name].startsWith('node scripts/fix-opennext-response-cancellation.js && '), name);
  }
});
