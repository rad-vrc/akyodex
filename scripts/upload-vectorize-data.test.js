const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRequestHeaders,
  getIngestToken,
  getWorkerUrl,
  isRetryableStatus,
  parseArgs,
  sendBatch,
  validateRecordsPayload,
} = require('./upload-vectorize-data');

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test('accepts only a batch size from 1 through 1000', () => {
  assert.deepEqual(parseArgs(['--batch-size', '25', '--dry-run']), {
    batchSize: 25,
    dryRun: true,
  });
  assert.equal(parseArgs(['--batch-size', '1000']).batchSize, 1000);

  for (const value of ['0', '-1', '1.5', '1001', '50x', 'not-a-number']) {
    assert.throws(
      () => parseArgs(['--batch-size', value]),
      /--batch-size must be an integer from 1 through 1000/
    );
  }
  assert.throws(
    () => parseArgs(['--batch-size']),
    /--batch-size must be an integer from 1 through 1000/
  );
});

test('requires the vector payload to be an array', () => {
  const records = [{ id: '0001' }];
  assert.equal(validateRecordsPayload(records), records);
  assert.throws(
    () => validateRecordsPayload({ records }),
    /vectorize-payload.json must contain a records array/
  );
});

test('retries only transient HTTP statuses', () => {
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(413), false);
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
    return fakeResponse(200, {
      ok: true,
      processed: 0,
      indexed: 0,
      failed: 0,
      errors: [],
    });
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
  assert.ok(capturedRequest.options.signal instanceof AbortSignal);
});

test('does not retry permanent HTTP errors', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return fakeResponse(401, { error: 'Unauthorized' });
  };

  try {
    await assert.rejects(
      sendBatch([], 1, {
        workerUrl: 'https://preview.example/insert-data',
        ingestToken: 'wrong-value',
        retryDelayMs: 0,
      }),
      /failed without retry: HTTP 401/
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 1);
});

test('retries a transient response and then succeeds', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  let fetchCalls = 0;
  console.warn = () => undefined;
  global.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return fakeResponse(503, { error: 'Unavailable' });
    }
    return fakeResponse(200, {
      ok: true,
      processed: 0,
      indexed: 0,
      failed: 0,
      errors: [],
    });
  };

  try {
    await sendBatch([], 1, {
      workerUrl: 'https://preview.example/insert-data',
      ingestToken: 'secret-value',
      retryDelayMs: 0,
    });
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }

  assert.equal(fetchCalls, 2);
});

test('retries a network failure and then succeeds', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  let fetchCalls = 0;
  console.warn = () => undefined;
  global.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      throw new Error('connection reset');
    }
    return fakeResponse(200, {
      ok: true,
      processed: 0,
      indexed: 0,
      failed: 0,
      errors: [],
    });
  };

  try {
    await sendBatch([], 1, {
      workerUrl: 'https://preview.example/insert-data',
      ingestToken: 'secret-value',
      retryDelayMs: 0,
    });
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }

  assert.equal(fetchCalls, 2);
});

test('treats a 200 partial-failure response as a failed batch', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  let fetchCalls = 0;
  console.warn = () => undefined;
  global.fetch = async () => {
    fetchCalls += 1;
    return fakeResponse(200, {
      ok: false,
      processed: 1,
      indexed: 0,
      failed: 1,
      errors: [{ id: '0001', error: 'Vectorize unavailable' }],
    });
  };

  try {
    await assert.rejects(
      sendBatch([{ id: '0001' }], 1, {
        workerUrl: 'https://preview.example/insert-data',
        ingestToken: 'secret-value',
        retryDelayMs: 0,
      }),
      /failed after 3 retries: application failure/
    );
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }

  assert.equal(fetchCalls, 4);
});
