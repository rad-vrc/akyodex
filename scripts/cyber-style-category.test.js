const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const cyberStyleIds = ['0058', '0102', '0112', '0149'];
const excludedIds = ['0028', '0147', '0276', '0555'];

function splitCategories(value) {
  return String(value || '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
}

function assertAncestors(categories, category) {
  const parts = category.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    const ancestor = parts.slice(0, depth).join('/');
    assert.ok(
      categories.includes(ancestor),
      `${category} should include ancestor ${ancestor}`,
    );
  }
}

test('keeps the Vectorize payload aligned with the Cyber style migration', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  for (const record of records) {
    assert.ok(
      !splitCategories(record.category).includes('電子'),
      `Vectorize ID ${record.id} still uses 電子`,
    );
  }

  for (const id of cyberStyleIds) {
    const record = recordsById.get(id);
    assert.ok(record, `Vectorize should include cyber-style ID ${id}`);
    const categories = splitCategories(record.category);
    assert.ok(categories.includes('作風・スタイル/サイバーチック'));
    assertAncestors(categories, '作風・スタイル/サイバーチック');
  }

  for (const id of excludedIds) {
    const record = recordsById.get(id);
    assert.ok(record, `Vectorize should include excluded ID ${id}`);
    const categories = splitCategories(record.category);
    assert.ok(!categories.includes('作風・スタイル'));
    assert.ok(!categories.includes('作風・スタイル/サイバーチック'));
  }

  const batteryCategories = splitCategories(recordsById.get('0276').category);
  for (const category of [
    'エネルギー',
    'エネルギー/電気',
    '道具・文房具・生活用品',
  ]) {
    assert.ok(batteryCategories.includes(category), `Vectorize battery should retain ${category}`);
  }

});

test('automatic category processors do not restore the retired Electronic category', () => {
  const { createCategoryProcessor } = require('./update-categories-common');
  const cases = [
    {
      definitions: require('./category-definitions-ja'),
      legacy: '電子',
      nicknames: ['ロボットAkyo', 'サイバーAkyo', 'グリッチAkyo', 'バッテリーAkyo', 'νAkyo'],
    },
    {
      definitions: require('./category-definitions-en'),
      legacy: 'Electronic',
      nicknames: ['Robot Akyo', 'Cyber Akyo', 'Glitch Akyo', 'Battery Akyo', 'Nu Akyo'],
    },
  ];

  for (const { definitions, legacy, nicknames } of cases) {
    const processCategories = createCategoryProcessor(definitions);
    for (const nickname of nicknames) {
      assert.ok(
        !splitCategories(processCategories('', nickname)).includes(legacy),
        `${nickname} should not restore ${legacy}`,
      );
    }
  }
});
