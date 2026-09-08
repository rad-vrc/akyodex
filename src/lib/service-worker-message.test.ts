import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

for (const origin of ['https://akyodex.com', 'https://staging.akyodex.com']) {
  test(`SW accepts SKIP_WAITING only from its own origin (${origin})`, () => {
    const handlers = new Map<string, (event: unknown) => void>();
    let calls = 0;
    runInNewContext(source, {
      console: { log() {} },
      self: {
        location: { origin },
        addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
        skipWaiting: () => { calls++; return Promise.resolve(); },
      },
    });
    const handler = handlers.get('message')!;
    for (const untrusted of ['', 'null', 'https://other.example', `${origin}.evil.example`, origin.replace('https:', 'http:')]) {
      handler({ origin: untrusted, data: { type: 'SKIP_WAITING' } });
    }
    assert.equal(calls, 0, 'untrusted messages must not activate the worker');
    handler({ origin, data: null });
    handler({ origin, data: { type: 'UNKNOWN' } });
    assert.equal(calls, 0);
    handler({ origin, data: { type: 'SKIP_WAITING' } });
    assert.equal(calls, 1);
  });
}
