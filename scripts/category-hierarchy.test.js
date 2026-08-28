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

function readJsonRows(language) {
  const payload = JSON.parse(
    fs.readFileSync(
      path.join(rootDir, 'data', `akyo-data-${language}.json`),
      'utf8',
    ),
  );
  return payload.data;
}

function splitCategories(value) {
  return String(value || '')
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
}

function normalizeHierarchicalCategories(value) {
  const normalized = [];
  const seen = new Set();

  for (const category of splitCategories(value)) {
    const parts = category.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      const ancestor = parts.slice(0, depth).join('/');
      if (!seen.has(ancestor)) {
        normalized.push(ancestor);
        seen.add(ancestor);
      }
    }
    if (!seen.has(category)) {
      normalized.push(category);
      seen.add(category);
    }
  }

  return normalized.join(',');
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

test('uses the Nature hierarchy for plant categories in every language', () => {
  const expectations = {
    ja: {
      root: '自然',
      plant: '自然/植物',
      legacy: ['植物', '植物/苔', '植物/木の実'],
    },
    en: {
      root: 'Nature',
      plant: 'Nature/Plant',
      legacy: ['Plant', 'Moss', 'Nuts'],
    },
    ko: {
      root: '자연',
      plant: '자연/식물',
      legacy: ['식물', '식물/이끼', '식물/열매'],
    },
  };

  for (const [language, expected] of Object.entries(expectations)) {
    const rows = readCategoryRows(language);
    let plantRows = 0;

    for (const row of rows) {
      const categories = splitCategories(row.Category);
      for (const legacyCategory of expected.legacy) {
        assert.ok(
          !categories.includes(legacyCategory),
          `${language} ID ${row.ID} still uses ${legacyCategory}`,
        );
      }

      for (const category of categories.filter(
        (value) => value === expected.root || value.startsWith(`${expected.root}/`),
      )) {
        assertAncestors(categories, category);
      }

      if (categories.includes(expected.plant)) {
        plantRows += 1;
      }
    }

    assert.ok(plantRows > 0, `${language} should include plant records under Nature`);
  }
});

test('uses Shape and Texture as the parent of the Small category', () => {
  const rows = readCategoryRows('ja');
  const row = rows.find((record) => record.ID === '0937');
  assert.ok(row, 'Japanese CSV should include ID 0937');

  const categories = splitCategories(row.Category);
  assert.ok(!categories.includes('小さい'));
  assert.ok(categories.includes('形状・触り心地'));
  assert.ok(categories.includes('形状・触り心地/小さい'));
});

test('defines canonical English and Korean translations for the new hierarchy', () => {
  const englishMap = require('./category-ja-en-map');
  const { CATEGORY_MAP: koreanMap } = require('./category-definitions-ko');

  assert.equal(englishMap['自然'], 'Nature');
  assert.equal(englishMap['自然/岩石'], 'Nature/Rock');
  assert.equal(englishMap['自然/植物'], 'Nature/Plant');
  assert.equal(englishMap['自然/植物/木の実'], 'Nature/Plant/Nuts');
  assert.equal(englishMap['自然/植物/苔'], 'Nature/Plant/Moss');
  assert.equal(
    englishMap['形状・触り心地/小さい'],
    'Shape・Texture/Small',
  );

  assert.equal(koreanMap['自然'], '자연');
  assert.equal(koreanMap['自然/岩石'], '자연/암석');
  assert.equal(koreanMap['自然/植物'], '자연/식물');
  assert.equal(koreanMap['自然/植物/木の実'], '자연/식물/열매');
  assert.equal(koreanMap['自然/植物/苔'], '자연/식물/이끼');
  assert.equal(
    koreanMap['形状・触り心地/小さい'],
    '형태・촉감/작은',
  );
});

test('keeps CSV and JSON categories identical in every language', () => {
  for (const language of ['ja', 'en', 'ko']) {
    const csvCategoriesById = new Map(
      readCategoryRows(language).map((row) => [
        row.ID,
        normalizeHierarchicalCategories(row.Category),
      ]),
    );
    const jsonRows = readJsonRows(language);

    assert.equal(jsonRows.length, csvCategoriesById.size);
    for (const row of jsonRows) {
      assert.equal(
        row.category,
        csvCategoriesById.get(row.id),
        `${language} ID ${row.id} category differs between CSV and JSON`,
      );
    }
  }
});

test('keeps the Vectorize payload on the canonical Japanese hierarchy', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  let plantRecords = 0;

  for (const record of records) {
    const categories = splitCategories(record.category);
    for (const legacyCategory of [
      '植物',
      '植物/苔',
      '苔',
      '植物/木の実',
      '木の実',
      '小さい',
    ]) {
      assert.ok(
        !categories.includes(legacyCategory),
        `Vectorize ID ${record.id} still uses ${legacyCategory}`,
      );
    }
    for (const category of categories.filter(
      (value) => value === '自然' || value.startsWith('自然/'),
    )) {
      assertAncestors(categories, category);
    }
    if (categories.includes('自然/植物')) {
      plantRecords += 1;
    }
  }

  assert.ok(plantRecords > 0, 'Vectorize should include plant records under Nature');
});

test('automatic category processors emit the complete Nature plant hierarchy', () => {
  const { createCategoryProcessor } = require('./update-categories-common');
  const japaneseProcessor = createCategoryProcessor(
    require('./category-definitions-ja'),
  );
  const englishProcessor = createCategoryProcessor(
    require('./category-definitions-en'),
  );

  assert.deepEqual(
    splitCategories(japaneseProcessor('', 'サボテンAkyo')).filter((category) =>
      category.startsWith('自然'),
    ),
    ['自然', '自然/植物'],
  );
  assert.deepEqual(
    splitCategories(englishProcessor('', 'Cactus Akyo')).filter((category) =>
      category.startsWith('Nature'),
    ),
    ['Nature', 'Nature/Plant'],
  );
});
