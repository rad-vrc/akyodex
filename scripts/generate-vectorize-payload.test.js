const assert = require('node:assert/strict');
const test = require('node:test');

const payloadGenerator = require('./generate-vectorize-payload');

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
