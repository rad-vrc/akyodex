import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'csv-stringify/sync';
import { processAkyoBatchUpdate } from './akyo-batch-update';
import { getAkyoEditFields } from './akyo-edit-fields';
import { createAkyoRecord, parseCsvToAkyoData, type commitAkyoCsv } from './csv-utils';

const header = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL', 'SourceURL', 'EntryType', 'DisplaySerial', 'BoothURL'];
const url = 'https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc';
const worldUrl = 'https://vrchat.com/home/world/wrld_12345678-1234-1234-1234-123456789abc';

function fixture() {
  const records = ['0001', '0002', '0003'].map((id) => createAkyoRecord({
    id, nickname: `Akyo ${id}`, avatarName: 'Akyo', category: '動物', author: 'Author',
    comment: 'original', entryType: 'avatar', displaySerial: id, sourceUrl: url,
  }, header));
  const data = parseCsvToAkyoData(stringify([header, ...records]));
  const updates = data.slice(0, 2).map((akyo) => {
    const original = getAkyoEditFields(akyo);
    return { original, changes: { ...original, nickname: `${original.nickname} edited`, comment: 'comma, newline\nquoted "value"' } };
  });
  const commits: Parameters<typeof commitAkyoCsv>[0][] = [];
  let loads = 0;
  const dependencies = {
    load: async () => { loads++; return { header, dataRecords: records, fileSha: 'original-sha' }; },
    commit: async (args: Parameters<typeof commitAkyoCsv>[0]) => {
      commits.push(args);
      return { commit: { html_url: 'https://github.com/example/repo/commit/test' } };
    },
  };
  return { records, data, updates, commits, dependencies, loads: () => loads };
}

for (const count of [1, 2]) {
  test(`${count} updates produce exactly one SHA-guarded commit and preserve unrelated rows`, async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const response = await processAkyoBatchUpdate(f.updates.slice(0, count), f.dependencies);
    assert.equal(response.status, 200);
    assert.equal(f.loads(), 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.commits[0].fileSha, 'original-sha');
    assert.deepEqual(f.records, before, 'input CSV rows must not be mutated');
    assert.deepEqual(f.commits[0].dataRecords[2], before[2]);
    const body = await response.json();
    assert.equal(body.data.length, count);
    assert.equal(body.data[0].comment, f.updates[0].changes.comment);
    assert.equal(body.data[0].displaySerial, '0001');
  });
}

test('invalid last record, duplicate IDs, empty/oversize batches perform no writes', async () => {
  const f = fixture();
  const bad = structuredClone(f.updates);
  bad[1].changes.sourceUrl = 'https://example.com/invalid';
  for (const input of [bad, [f.updates[0], f.updates[0]], [], Array(101).fill(f.updates[0]), [{ changes: {} }]]) {
    assert.equal((await processAkyoBatchUpdate(input, f.dependencies)).status, 400);
  }
  assert.equal(f.commits.length, 0);
  assert.equal(f.loads(), 0);
});

test('concurrent edits and missing records reject the whole batch before committing', async () => {
  for (const deleted of [false, true]) {
    const f = fixture();
    if (deleted) f.records.splice(1, 1);
    else f.records[1][1] = 'Changed by another editor';
    const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
    assert.equal(response.status, 409);
    assert.equal(f.commits.length, 0);
  }
});

test('JSON-normalized newlines and category ancestors do not create false conflicts', async () => {
  const f = fixture();
  f.records[0][3] = 'Parent/Child,Parent,Other';
  f.records[0][4] = 'first\r\nsecond';
  f.updates[0].original.category = 'Parent,Parent/Child,Other';
  f.updates[0].original.comment = 'first\nsecond';
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
});

test('multiple world conversions allocate distinct serials and world ancestors', async () => {
  const f = fixture();
  for (const update of f.updates) Object.assign(update.changes, {
    entryType: 'world', sourceUrl: worldUrl, displaySerial: '', avatarName: '',
  });
  const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((row: { displaySerial: string }) => row.displaySerial), ['0001', '0002']);
  assert.ok(data.every((row: { category: string }) => row.category.includes('ワールド')));
});

test('multiple BOOTH conversions allocate distinct serials', async () => {
  const f = fixture();
  for (const update of f.updates) Object.assign(update.changes, {
    entryType: 'booth', sourceUrl: '', boothUrl: 'https://booth.pm/ja/items/123', avatarName: '',
  });
  const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((row: { displaySerial: string }) => row.displaySerial), ['Booth0001', 'Booth0002']);
});

test('GitHub conflict is not retried or reported as success', async (t) => {
  const f = fixture();
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  f.dependencies.commit = async () => { calls++; throw new Error('GitHub commit failed: 409'); };
  assert.equal((await processAkyoBatchUpdate(f.updates, f.dependencies)).status, 500);
  assert.equal(calls, 1);
});

test('clearing comments and BOOTH links is saved without reviving legacy aliases', async () => {
  const f = fixture();
  f.updates[0].changes.comment = '';
  f.updates[0].changes.boothUrl = '';
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data[0].comment, '');
  assert.equal(data[0].notes, '');
  assert.equal(data[0].boothUrl, undefined);
});
