const assert = require('node:assert/strict');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

test('duplicate prototype headers remain own data properties in grouped CSV records', () => {
  // GHSA-8cw4-87c7-c6xx: exercise the dependency even though the app uses array rows.
  const [record] = parse('__proto__,__proto__,name\nfirst,second,safe', {
    columns: true,
    group_columns_by_name: true,
  });
  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.equal(Object.hasOwn(record, '__proto__'), true);
  assert.deepEqual(record.__proto__, ['first', 'second']);
  assert.equal(record.name, 'safe');
});

test('array CSV parsing preserves special headers, quoted commas and embedded newlines', () => {
  const records = parse('__proto__,__proto__,Comment\r\nfirst,second,"quoted ""text"",\nnext line"\r\n', {
    columns: false,
    record_delimiter: ['\r\n', '\n', '\r'],
    skip_empty_lines: true,
    trim: false,
  });
  assert.deepEqual(records, [
    ['__proto__', '__proto__', 'Comment'],
    ['first', 'second', 'quoted "text",\nnext line'],
  ]);
});
