const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRequestHeaders,
  getIngestToken,
  getWorkerUrl,
  parseArgs,
  sendBatch,
} = require('./upload-vectorize-data');

test('accepts only a positive integer batch size', () => {
  assert.deepEqual(parseArgs(['--batch-size', '25', '--dry-run']), {
    batchSize: 25,
    dryRun: true,
  });

  for (const value of ['0', '-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--batch-size', value]),
      /--batch-size must be a positive integer/
    );
  }
  assert.throws(
    () => parseArgs(['--batch-size']),
    /--batch-size must be a positive integer/
  );
});

test('requires the ingest token outside dry-run orchestration', () => {
  assert.throws(
    () => getIngestToken({}),
    /AKYO_INGEST_TOKEN is not configured/
  );
  assert.equal(getIngestToken({ AKYO_INGEST_TOKEN: '  secret-value  ' }), 'secret-value');
});

test('uses the production endpoint by default and accepts a preview override', () => {
  assert.equal(
    getWorkerUrl({}),
    'https://akyo-search-worker.dorado1031.workers.dev/insert-data'
  );
  assert.equal(
    getWorkerUrl({ AKYO_WORKER_URL: ' https://preview.example/insert-data ' }),
    'https://preview.example/insert-data'
  );
});

test('builds an authenticated JSON request', () => {
  assert.deepEqual(buildRequestHeaders('secret-value'), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer secret-value',
  });
  assert.throws(() => buildRequestHeaders(''), /ingest token is required/);
});

test('sends records with the configured bearer token', async () => {
  const originalFetch = global.fetch;
  let capturedRequest;
  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      async json() {
        return { processed: 0, indexed: 0, failed: 0, errors: [] };
      },
    };
  };

  try {
    await sendBatch([], 1, {
      workerUrl: 'https://preview.example/insert-data',
      ingestToken: 'secret-value',
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(capturedRequest.url, 'https://preview.example/insert-data');
  assert.equal(capturedRequest.options.method, 'POST');
  assert.equal(
    capturedRequest.options.headers.Authorization,
    'Bearer secret-value'
  );
  assert.equal(capturedRequest.options.body, '{"records":[]}');
});
