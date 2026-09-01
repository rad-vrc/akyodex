const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const rootDir = path.resolve(__dirname, '..');
const cyberStyleIds = ['0058', '0102', '0112', '0149'];
const excludedIds = ['0028', '0147', '0276', '0555'];

const categoriesByLanguage = {
  ja: {
    legacy: '電子',
    parent: '作風・スタイル',
    child: '作風・スタイル/サイバーチック',
    battery: ['エネルギー', 'エネルギー/電気', '道具・文房具・生活用品'],
  },
  en: {
    legacy: 'Electronic',
    parent: 'Style',
    child: 'Style/Cyber',
    battery: ['Energy', 'Energy/Electricity', 'Daily Necessities'],
  },
  ko: {
    legacy: '전자',
    parent: '스타일',
    child: '스타일/사이버풍',
    battery: ['에너지', '에너지/전기', '도구・문구・생활용품'],
  },
};

function splitCategories(value) {
  return String(value || '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
}

function readCsvRows(language) {
  return parse(
    fs.readFileSync(
      path.join(rootDir, 'data', `akyo-data-${language}.csv`),
      'utf8',
    ),
    {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: ['\r\n', '\n', '\r'],
    },
  );
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

test('replaces Electronic with Cyber style only on the four approved entries', () => {
  for (const [language, expected] of Object.entries(categoriesByLanguage)) {
    const rows = readCsvRows(language);
    const rowsById = new Map(rows.map((row) => [row.ID, row]));

    for (const row of rows) {
      assert.ok(
        !splitCategories(row.Category).includes(expected.legacy),
        `${language} ID ${row.ID} still uses ${expected.legacy}`,
      );
    }

    for (const id of cyberStyleIds) {
      const row = rowsById.get(id);
      assert.ok(row, `${language} should include cyber-style ID ${id}`);
      const categories = splitCategories(row.Category);
      assert.ok(categories.includes(expected.child), `${language} ID ${id} should include ${expected.child}`);
      assertAncestors(categories, expected.child);
    }

    for (const id of excludedIds) {
      const row = rowsById.get(id);
      assert.ok(row, `${language} should include excluded ID ${id}`);
      const categories = splitCategories(row.Category);
      assert.ok(!categories.includes(expected.parent), `${language} ID ${id} should not include ${expected.parent}`);
      assert.ok(!categories.includes(expected.child), `${language} ID ${id} should not include ${expected.child}`);
    }

    assert.deepEqual(
      expected.battery.filter((category) =>
        splitCategories(rowsById.get('0276').Category).includes(category),
      ),
      expected.battery,
      `${language} battery should retain its energy and daily-necessities categories`,
    );
  }
});

test('defines English and Korean translations for the Cyber style hierarchy', () => {
  const englishMap = require('./category-ja-en-map');
  const { CATEGORY_MAP: koreanMap } = require('./category-definitions-ko');

  assert.equal(englishMap['作風・スタイル'], 'Style');
  assert.equal(englishMap['作風・スタイル/サイバーチック'], 'Style/Cyber');
  assert.equal(koreanMap['作風・スタイル'], '스타일');
  assert.equal(koreanMap['作風・スタイル/サイバーチック'], '스타일/사이버풍');
  assert.equal(Object.hasOwn(englishMap, '電子'), false);
  assert.equal(Object.hasOwn(koreanMap, '電子'), false);
});

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
