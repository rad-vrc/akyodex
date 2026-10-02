const assert = require('node:assert/strict');
const test = require('node:test');

const payloadGenerator = require('./generate-vectorize-payload');

test('preserves displayed numbers independently of storage IDs', () => {
  const records = payloadGenerator.buildPayload([
    { id: '0746', entryType: 'world', displaySerial: '0001' },
    { id: '2030', entryType: 'avatar', displaySerial: '0896' },
    { id: '0002', entryType: 'avatar' },
  ]);
  assert.deepEqual(records.map(({ id, publicId }) => [id, publicId]), [
    ['0746', 'World0001'], ['2030', 'Avatar0896'], ['0002', 'Avatar0002'],
  ]);
});

test('preserves world entry type in generated Vectorize records', () => {
  assert.equal(typeof payloadGenerator.buildPayload, 'function');

  const records = payloadGenerator.buildPayload({
    data: [
      {
        id: '0929',
        entryType: 'world',
        nickname: 'Akyoつりぼり',
        avatarName: '',
        category: 'ワールド',
        comment: '',
        author: 'yuwa1027',
        avatarUrl: 'https://vrchat.com/home/world/wrld-example/',
      },
    ],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].entryType, 'world');
});
