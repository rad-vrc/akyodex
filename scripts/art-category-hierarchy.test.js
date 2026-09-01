const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const rootDir = path.resolve(__dirname, '..');

function readCategoryRows(language) {
  const csv = fs.readFileSync(
    path.join(rootDir, 'data', `akyo-data-${language}.csv`),
    'utf8',
  );
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    record_delimiter: ['\r\n', '\n', '\r'],
  });
}

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

const artParents = {
  ja: '芸術',
  en: 'Art',
  ko: '예술',
};

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

const legacyCategories = {
  ja: ['芸術・アート', '像・埴輪', '音楽・楽器'],
  en: ['Statue', 'Music・Instrument'],
  ko: ['예술・아트', '상・하니와', '음악・악기'],
};

test('places decided art records in their approved hierarchy', () => {
  for (const language of ['ja', 'en', 'ko']) {
    const rows = readCategoryRows(language);
    const rowsById = new Map(rows.map((row) => [row.ID, row]));

    for (const legacyCategory of legacyCategories[language]) {
      for (const row of rows) {
        assert.ok(
          !splitCategories(row.Category).includes(legacyCategory),
          `${language} ID ${row.ID} still uses ${legacyCategory}`,
        );
      }
    }

    for (const assignment of artAssignments) {
      const child = assignment[language];
      for (const id of assignment.ids) {
        const row = rowsById.get(id);
        if (!row) {
          assert.notEqual(language, 'ja', `Japanese data should include art ID ${id}`);
          continue;
        }
        const categories = splitCategories(row.Category);
        assert.ok(categories.includes(child), `${language} ID ${id} should include ${child}`);
        assertAncestors(categories, child);
      }
    }

    for (const id of parentOnlyIds) {
      const row = rowsById.get(id);
      if (!row) {
        assert.notEqual(language, 'ja', `Japanese data should include art ID ${id}`);
        continue;
      }
      const categories = splitCategories(row.Category);
      assert.ok(categories.includes(artParents[language]));
      for (const assignment of artAssignments) {
        assert.ok(
          !categories.includes(assignment[language]),
          `${language} ID ${id} should keep only the Art parent`,
        );
      }
    }
  }
});

test('keeps the Tower of the Sun as both architecture and a building', () => {
  const buildingCategories = { ja: '建物', en: 'Building', ko: '건물' };
  for (const language of ['ja', 'en', 'ko']) {
    const row = readCategoryRows(language).find((record) => record.ID === '0460');
    assert.ok(row, `${language} should include Tower of the Sun ID 0460`);
    const categories = splitCategories(row.Category);
    assert.ok(categories.includes(artParents[language]));
    assert.ok(categories.includes(artAssignments[3][language]));
    assert.ok(categories.includes(buildingCategories[language]));
  }
});

test('keeps haniwa history tags while classifying their sculptural form', () => {
  const historyCategories = { ja: '歴史', en: 'History', ko: '역사' };
  for (const language of ['ja', 'en', 'ko']) {
    const rowsById = new Map(readCategoryRows(language).map((row) => [row.ID, row]));
    for (const id of ['0336', '0459', '0461']) {
      const row = rowsById.get(id);
      assert.ok(row, `${language} should include haniwa ID ${id}`);
      const categories = splitCategories(row.Category);
      assert.ok(categories.includes(historyCategories[language]));
      assert.ok(categories.includes(artAssignments[2][language]));
    }
  }
});

test('keeps real-photo records out of the new art subcategories for now', () => {
  const realPhotoCategories = {
    ja: '作風・スタイル/実写',
    en: 'Style/Real Photo',
    ko: '스타일/실사',
  };
  for (const language of ['ja', 'en', 'ko']) {
    const rowsById = new Map(readCategoryRows(language).map((row) => [row.ID, row]));
    for (const id of parentOnlyIds) {
      const row = rowsById.get(id);
      if (!row) continue;
      assert.ok(splitCategories(row.Category).includes(realPhotoCategories[language]));
    }
  }
});

test('defines English and Korean translations for the art hierarchy', () => {
  const englishMap = require('./category-ja-en-map');
  const { CATEGORY_MAP: koreanMap } = require('./category-definitions-ko');

  assert.equal(englishMap['芸術'], 'Art');
  assert.equal(koreanMap['芸術'], '예술');
  for (const assignment of artAssignments) {
    assert.equal(englishMap[assignment.ja], assignment.en);
    assert.equal(koreanMap[assignment.ja], assignment.ko);
  }
});

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
