const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const rootDir = path.resolve(__dirname, '..');

const styleMigrations = [
  {
    ids: ['0055', '0056', '0109', '0535', '0686', '0731'],
    vectorizeIds: ['0109', '0535'],
    ja: ['実写', '作風・スタイル/実写'],
    en: ['Real Photo', 'Style/Real Photo'],
    ko: ['실사', '스타일/실사'],
  },
  {
    ids: ['0042', '0063', '0216', '0238', '0827', '0935', '0937'],
    vectorizeIds: ['0042'],
    ja: ['ローポリ', '作風・スタイル/ローポリ'],
    en: ['Low-poly', 'Style/Low-poly'],
    ko: ['로우폴리', '스타일/로우폴리'],
  },
  {
    ids: ['0564', '0702', '0735', '0736', '0737'],
    vectorizeIds: ['0564'],
    ja: ['デフォルメ', '作風・スタイル/デフォルメ'],
    en: ['Deformed', 'Style/Deformed'],
    ko: ['디포르메', '스타일/디포르메'],
  },
  {
    ids: ['0536', '0669', '0826'],
    vectorizeIds: ['0536'],
    ja: ['ホラー', '作風・スタイル/ホラー'],
    en: ['Horror', 'Style/Horror'],
    ko: ['호러', '스타일/호러'],
  },
  {
    ids: ['0675'],
    vectorizeIds: [],
    ja: ['グロテスク', '作風・スタイル/グロテスク'],
    en: ['Grotesque', 'Style/Grotesque'],
    ko: ['그로테스크', '스타일/그로테스크'],
  },
  {
    ids: [
      '0116', '0198', '0230', '0239', '0366', '0383', '0415', '0432', '0531',
      '0538', '0565', '0580', '0629', '0634', '0645', '0662', '0711', '0869',
    ],
    vectorizeIds: [],
    ja: ['プリティ', '作風・スタイル/プリティ'],
    en: ['Pretty', 'Style/Pretty'],
    ko: ['프리티', '스타일/프리티'],
  },
];

const specialAssignments = {
  ja: {
    styleParent: '作風・スタイル',
    sciFi: '作風・スタイル/SF',
    gimmickParent: 'ギミック・特殊',
    glow: 'ギミック・特殊/発光',
  },
  en: {
    styleParent: 'Style',
    sciFi: 'Style/Sci-Fi',
    gimmickParent: 'Gimmick・Special',
    glow: 'Gimmick・Special/Glow',
  },
  ko: {
    styleParent: '스타일',
    sciFi: '스타일/SF',
    gimmickParent: '기믹・특수',
    glow: '기믹・특수/발광',
  },
};

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
    assert.ok(categories.includes(ancestor), `${category} should include ${ancestor}`);
  }
}

test('moves all approved visual-style categories under Style', () => {
  for (const language of ['ja', 'en', 'ko']) {
    const rows = readCsvRows(language);
    const rowsById = new Map(rows.map((row) => [row.ID, row]));

    for (const migration of styleMigrations) {
      const [legacy, child] = migration[language];
      for (const row of rows) {
        assert.ok(
          !splitCategories(row.Category).includes(legacy),
          `${language} ID ${row.ID} still uses root category ${legacy}`,
        );
      }

      for (const id of migration.ids) {
        const row = rowsById.get(id);
        if (!row) {
          assert.notEqual(language, 'ja', `Japanese data should include style ID ${id}`);
          continue;
        }
        const categories = splitCategories(row.Category);
        assert.ok(categories.includes(child), `${language} ID ${id} should include ${child}`);
        assertAncestors(categories, child);
      }
    }
  }
});

test('adds Sci-Fi to Security and Glow to Gaming without broadening rejected styles', () => {
  for (const [language, expected] of Object.entries(specialAssignments)) {
    const rowsById = new Map(readCsvRows(language).map((row) => [row.ID, row]));

    const security = rowsById.get('0865');
    assert.ok(security, `${language} should include Security ID 0865`);
    const securityCategories = splitCategories(security.Category);
    assert.ok(securityCategories.includes(expected.sciFi));
    assertAncestors(securityCategories, expected.sciFi);

    const gaming = rowsById.get('0917');
    if (gaming) {
      const gamingCategories = splitCategories(gaming.Category);
      assert.ok(gamingCategories.includes(expected.glow));
      assertAncestors(gamingCategories, expected.glow);
      assert.ok(!gamingCategories.includes(expected.styleParent));
    }

    for (const id of ['0038', '0103', '0710']) {
      const row = rowsById.get(id);
      if (!row) continue;
      const categories = splitCategories(row.Category);
      assert.ok(!categories.includes(expected.styleParent), `${language} ID ${id} should not be Style`);
    }
  }
});

test('defines translations for every adopted Style and Glow category', () => {
  const englishMap = require('./category-ja-en-map');
  const { CATEGORY_MAP: koreanMap } = require('./category-definitions-ko');

  for (const migration of styleMigrations) {
    assert.equal(englishMap[migration.ja[1]], migration.en[1]);
    assert.equal(koreanMap[migration.ja[1]], migration.ko[1]);
    assert.equal(Object.hasOwn(englishMap, migration.ja[0]), false);
    assert.equal(Object.hasOwn(koreanMap, migration.ja[0]), false);
  }
  assert.equal(englishMap['作風・スタイル/SF'], 'Style/Sci-Fi');
  assert.equal(koreanMap['作風・スタイル/SF'], '스타일/SF');
  assert.equal(englishMap['ギミック・特殊/発光'], 'Gimmick・Special/Glow');
  assert.equal(koreanMap['ギミック・特殊/発光'], '기믹・특수/발광');
});

test('keeps Vectorize records on the adopted Style hierarchy', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  const rowsById = new Map(records.map((record) => [record.id, record]));

  for (const migration of styleMigrations) {
    const [legacy, child] = migration.ja;
    for (const record of records) {
      assert.ok(!splitCategories(record.category).includes(legacy));
    }
    for (const id of migration.vectorizeIds) {
      assert.ok(rowsById.has(id), `Vectorize should include style ID ${id}`);
      const categories = splitCategories(rowsById.get(id).category);
      assert.ok(categories.includes(child), `Vectorize ID ${id} should include ${child}`);
      assertAncestors(categories, child);
    }
  }
});

test('automatic real-photo categorization emits the complete Style hierarchy', () => {
  const { createCategoryProcessor } = require('./update-categories-common');
  const cases = [
    {
      definitions: require('./category-definitions-ja'),
      nickname: 'リアルAkyo',
      expected: ['作風・スタイル', '作風・スタイル/実写'],
      legacy: '実写',
    },
    {
      definitions: require('./category-definitions-en'),
      nickname: 'Real Akyo',
      expected: ['Style', 'Style/Real Photo'],
      legacy: 'Real Photo',
    },
  ];

  for (const { definitions, nickname, expected, legacy } of cases) {
    const categories = splitCategories(createCategoryProcessor(definitions)('', nickname));
    for (const category of expected) assert.ok(categories.includes(category));
    assert.ok(!categories.includes(legacy));
  }
});
