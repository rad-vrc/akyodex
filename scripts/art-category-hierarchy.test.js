const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');

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

const artAssignments = [
  {
    ids: ['0071', '0075', '0077', '0080', '0476', '0477', '0498', '0626', '0684'],
    vectorizeIds: ['0071', '0075', '0077', '0080', '0476', '0477', '0498', '0626'],
    ja: '芸術/絵画・イラスト',
    en: 'Art/Painting・Illustration',
    ko: '예술/회화・일러스트',
  },
  {
    ids: ['0091'],
    vectorizeIds: ['0091'],
    ja: '芸術/工芸品',
    en: 'Art/Craft',
    ko: '예술/공예품',
  },
  {
    ids: ['0331', '0336', '0455', '0459', '0461', '0503', '0639'],
    vectorizeIds: ['0331', '0336', '0455', '0459', '0461', '0503', '0639'],
    ja: '芸術/彫刻・像',
    en: 'Art/Sculpture・Statue',
    ko: '예술/조각・상',
  },
  {
    ids: ['0460'],
    vectorizeIds: ['0460'],
    ja: '芸術/建築',
    en: 'Art/Architecture',
    ko: '예술/건축',
  },
  {
    ids: ['0086', '0113', '0143', '0543', '0716', '0921'],
    vectorizeIds: ['0086', '0113', '0143', '0543'],
    ja: '芸術/音楽・楽器',
    en: 'Art/Music・Instrument',
    ko: '예술/음악・악기',
  },
];

const parentOnlyIds = ['0109', '0535', '0731'];

test('keeps targeted Vectorize records on the new art hierarchy', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  for (const assignment of artAssignments) {
    for (const id of assignment.vectorizeIds) {
      const record = recordsById.get(id);
      assert.ok(record, `Vectorize should include art ID ${id}`);
      const categories = splitCategories(record.category);
      assert.ok(categories.includes(assignment.ja));
      assertAncestors(categories, assignment.ja);
    }
  }

  for (const id of parentOnlyIds.filter((value) => recordsById.has(value))) {
    const categories = splitCategories(recordsById.get(id).category);
    assert.ok(categories.includes('芸術'));
    for (const assignment of artAssignments) {
      assert.ok(!categories.includes(assignment.ja));
    }
  }

  for (const id of ['0336', '0459', '0461']) {
    const record = recordsById.get(id);
    assert.ok(record, `Vectorize should include haniwa ID ${id}`);
    assert.ok(splitCategories(record.category).includes('歴史'));
  }
});

test('automatic category processors emit only the current Art hierarchy', () => {
  const { createCategoryProcessor } = require('./update-categories-common');
  const japaneseProcessor = createCategoryProcessor(
    require('./category-definitions-ja'),
  );
  const englishProcessor = createCategoryProcessor(
    require('./category-definitions-en'),
  );

  const cases = [
    {
      actual: japaneseProcessor('', '絵画Akyo'),
      includes: ['芸術'],
      excludes: ['芸術・アート'],
    },
    {
      actual: japaneseProcessor('', 'おんがくAkyo'),
      includes: ['芸術', '芸術/音楽・楽器'],
      excludes: ['芸術・アート', '音楽・楽器'],
    },
    {
      actual: japaneseProcessor('', 'リアルAkyo'),
      includes: ['芸術'],
      excludes: ['芸術・アート'],
    },
    {
      actual: englishProcessor('', 'Painting Akyo'),
      includes: ['Art'],
      excludes: [],
    },
    {
      actual: englishProcessor('', 'Music Akyo'),
      includes: ['Art', 'Art/Music・Instrument'],
      excludes: ['Music・Instrument'],
    },
    {
      actual: japaneseProcessor('芸術・アート,音楽・楽器', 'Akyo'),
      includes: ['芸術', '芸術/音楽・楽器'],
      excludes: ['芸術・アート', '音楽・楽器'],
    },
    {
      actual: englishProcessor('Music・Instrument', 'Akyo'),
      includes: ['Art', 'Art/Music・Instrument'],
      excludes: ['Music・Instrument'],
    },
  ];

  for (const { actual, includes, excludes } of cases) {
    const categories = splitCategories(actual);
    for (const category of includes) {
      assert.ok(categories.includes(category), `${actual} should include ${category}`);
    }
    for (const category of excludes) {
      assert.ok(!categories.includes(category), `${actual} should not include ${category}`);
    }
  }
});
