const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
