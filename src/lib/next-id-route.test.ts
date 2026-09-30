import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { stringify } from 'csv-stringify/sync';
import * as csvUtils from './csv-utils';
import * as idState from './next-id-state';

// Execute the real GET handler in isolation: only network, authentication, and
// Cloudflare bindings are replaced. A fresh module also resets its CSV cache.
const route = ts.transpileModule(
  readFileSync(path.join(process.cwd(), 'src/app/api/admin/next-id/route.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

function fixture(csv: string, hint: number | null = null, authenticated = true) {
  let reads = 0;
  const exports: { GET?: () => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    'next/server': { connection: async () => {} },
    '@/lib/api-helpers': {
      validateSession: async () => authenticated ? { id: 'admin' } : null,
      jsonError: (error: string, status: number, extra = {}) => Response.json({ error, ...extra }, { status }),
    },
    '@/lib/github-utils': { fetchCSVFromGitHub: () => { throw new Error('Unexpected GitHub request'); } },
    '@/lib/csv-utils': csvUtils,
    '@/lib/next-id-state': { ...idState, readNextIdHint: async () => hint },
    '@opennextjs/cloudflare': {
      getCloudflareContext: () => ({ env: { AKYO_BUCKET: { get: async () => {
        reads++;
        return { text: async () => csv };
      } } } }),
    },
    'fs/promises': { readFile: () => { throw new Error('Unexpected local read'); } },
    path,
  };
  vm.runInNewContext(route, {
    exports, Response, setTimeout, clearTimeout,
    process: { env: {}, cwd: () => process.cwd() },
    console: { warn: () => {}, error: () => {} },
    fetch: () => { throw new Error('Unexpected public fetch'); },
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return { get: () => exports.GET!(), reads: () => reads };
}

const header = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL', 'EntryType', 'DisplaySerial'];
function row(id: string, comment = '', entryType = 'avatar', displaySerial = id) {
  return [id, 'Nickname', 'Avatar', '', comment, 'Author', '', entryType, displaySerial];
}
async function expectNext(csv: string, expected: string, hint: number | null = null) {
  const response = await fixture(csv, hint).get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nextId: expected });
}

test('next-id ignores 1952 at the start of a multiline comment (production regression)', async () => {
  await expectNext(stringify([header, row('1004', 'Notes\n1952 year, quoted "text"')]), '1005');
});

test('next-id ignores 2020 after a newline instead of jumping from 1954 to 2021', async () => {
  await expectNext(stringify([header, row('1954', 'Notes\n2020 year')]), '1955');
});

test('next-id preserves issued IDs and counts avatars, worlds, and BOOTH rows together', async () => {
  await expectNext(stringify([header, row('2023', '1952\n2020', 'avatar', '0889'),
    row('1953', '', 'world', '0118'), row('1900', '', '', 'B9999')]), '2024');
});

test('next-id uses the ID column even when columns are reordered and non-ID fields start with numbers', async () => {
  await expectNext(stringify([['Author', 'Comment', 'DisplaySerial', 'ID'],
    ['9000', 'text\n9999, \"quoted\"', '8000', '1004']]), '1005');
});

test('next-id handles BOM and CRLF multiline CSV', async () => {
  await expectNext('\uFEFF' + stringify([header, row('1004', 'text\r\n9999 year')], { record_delimiter: '\r\n' }), '1005');
});

test('next-id accepts a header-only catalog', async () => {
  await expectNext(stringify([header]), '0001');
});

test('next-id keeps the larger persisted hint while CSV propagation is delayed', async () => {
  await expectNext(stringify([header, row('2023')]), '2025', 2025);
  await expectNext(stringify([header, row('2023')]), '2024', 1900);
});

test('next-id requires authentication before reading the catalog', async () => {
  const f = fixture(stringify([header, row('1004')]), null, false);
  assert.equal((await f.get()).status, 401);
  assert.equal(f.reads(), 0);
});

test('next-id fails closed for malformed CSV or missing ID columns', async () => {
  for (const csv of ['ID,Comment\n1004,"unterminated', 'ID,Comment\n1004,x,extra', 'Author,Comment\n9000,text']) {
    const response = await fixture(csv).get();
    assert.equal(response.status, 500, csv);
  }
});

test('next-id rejects malformed IDs rather than parsing numeric prefixes', async () => {
  for (const id of ['2020year', '1.5', '-1', '0', '', '9007199254740991']) {
    assert.equal((await fixture(stringify([header, row(id)])).get()).status, 500, id);
  }
});
