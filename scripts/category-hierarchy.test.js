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

const adoptedHierarchyMigrations = [
  {
    ids: ['0041', '0136', '0558', '0563', '0661'],
    vectorizeIds: ['0041', '0558', '0563'],
    ja: ['菌類', '自然/菌類'],
    en: ['Fungus', 'Nature/Fungus'],
    ko: ['균류', '자연/균류'],
  },
  {
    ids: ['0589', '0655', '0843'],
    vectorizeIds: ['0589'],
    ja: ['貝', '自然/貝'],
    en: ['Animal/Shell', 'Nature/Shell'],
    ko: ['조개', '자연/조개'],
  },
  {
    ids: ['0584', '0695'],
    vectorizeIds: ['0584'],
    ja: ['骨', '器官/骨'],
    en: ['Bone', 'Body Part/Bone'],
    ko: ['뼈', '기관/뼈'],
  },
  {
    ids: [
      '0199',
      '0215',
      '0251',
      '0255',
      '0256',
      '0288',
      '0291',
      '0318',
      '0374',
      '0459',
      '0698',
      '0699',
      '0732',
      '0740',
    ],
    vectorizeIds: [],
    ja: ['四足歩行', '技能・特性/四足歩行'],
    en: ['Quadruped', 'Skill・Trait/Quadruped'],
    ko: ['네발걸음', '기능・특성/네발걸음'],
  },
  {
    ids: ['0593', '0602', '0623', '0673', '0824', '0835', '0849'],
    vectorizeIds: [],
    ja: ['合体・変身', '技能・特性/合体・変身'],
    en: ['Transformation', 'Skill・Trait/Transformation'],
    ko: ['합체・변신', '기능・특성/합체・변신'],
  },
  {
    ids: ['0844'],
    vectorizeIds: [],
    ja: ['頭脳明晰', '技能・特性/頭脳明晰'],
    en: ['Intelligent', 'Skill・Trait/Intelligent'],
    ko: ['명석한 두뇌', '기능・특성/명석한 두뇌'],
  },
  {
    ids: ['0900'],
    vectorizeIds: [],
    ja: ['高身長', '体型/高身長'],
    en: ['Tall', 'Body Type/Tall'],
    ko: ['장신', '체형/장신'],
  },
  {
    ids: ['0485', '0501', '0502', '0624', '0740'],
    vectorizeIds: [],
    ja: ['睡眠', '状態/睡眠'],
    en: ['Sleep', 'Condition/Sleep'],
    ko: ['수면', '상태/수면'],
  },
  {
    ids: ['0533', '0534', '0635', '0844'],
    vectorizeIds: ['0635'],
    ja: ['死', '状態/死'],
    en: ['Death', 'Condition/Death'],
    ko: ['죽음', '상태/죽음'],
  },
  {
    ids: ['0740', '0844'],
    vectorizeIds: [],
    ja: ['復活', '状態/復活'],
    en: ['Revival', 'Condition/Revival'],
    ko: ['부활', '상태/부활'],
  },
  {
    ids: ['0475', '0691', '0724', '0903'],
    vectorizeIds: [],
    ja: ['囚われの身', '状態/囚われの身'],
    en: ['Captive', 'Condition/Captive'],
    ko: ['갇힌 몸', '상태/갇힌 몸'],
  },
  {
    ids: ['0616'],
    vectorizeIds: ['0616'],
    ja: ['精霊馬', '季節・行事/お盆/精霊馬'],
    en: ['Spirit Horse', 'Season・Event/Obon/Spirit Horse'],
    ko: ['정령마', '계절・행사/오봉/정령마'],
  },
  {
    ids: ['0282'],
    vectorizeIds: [],
    ja: ['ばんそうこう', '道具・文房具・生活用品/ばんそうこう'],
    en: ['Bandage', 'Daily Necessities/Bandage'],
    ko: ['반창고', '도구・문구・생활용품/반창고'],
  },
];

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
    for (const migration of adoptedHierarchyMigrations) {
      const [legacyCategory] = migration.ja;
      assert.ok(
        !categories.includes(legacyCategory),
        `Vectorize ID ${record.id} still uses ${legacyCategory}`,
      );
    }
    if (categories.includes('自然/植物')) {
      plantRecords += 1;
    }
  }

  assert.ok(plantRecords > 0, 'Vectorize should include plant records under Nature');
  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const migration of adoptedHierarchyMigrations) {
    const [, hierarchicalCategory] = migration.ja;
    for (const id of migration.vectorizeIds) {
      const record = recordsById.get(id);
      assert.ok(record, `Vectorize should include migrated ID ${id}`);
      const categories = splitCategories(record.category);
      assert.ok(
        categories.includes(hierarchicalCategory),
        `Vectorize ID ${id} should include ${hierarchicalCategory}`,
      );
      assertAncestors(categories, hierarchicalCategory);
    }
  }

  const battery = records.find((record) => record.id === '0276');
  assert.ok(battery, 'Vectorize should include battery ID 0276');
  const batteryCategories = splitCategories(battery.category);
  for (const category of [
    'エネルギー',
    'エネルギー/電気',
    '道具・文房具・生活用品',
  ]) {
    assert.ok(
      batteryCategories.includes(category),
      `Vectorize battery should include ${category}`,
    );
  }
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
