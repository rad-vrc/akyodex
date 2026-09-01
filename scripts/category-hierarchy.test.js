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

function assertAdoptedHierarchies(language, rows) {
  const rowsById = new Map(rows.map((row) => [row.ID, row]));

  for (const migration of adoptedHierarchyMigrations) {
    const [legacyCategory, hierarchicalCategory] = migration[language];
    for (const row of rows) {
      const categories = splitCategories(row.Category);
      assert.ok(
        !categories.includes(legacyCategory),
        `${language} ID ${row.ID} still uses isolated category ${legacyCategory}`,
      );
    }

    for (const id of migration.ids) {
      const row = rowsById.get(id);
      if (!row) {
        assert.notEqual(
          language,
          'ja',
          `Japanese source data should include migrated ID ${id}`,
        );
        continue;
      }
      const categories = splitCategories(row.Category);
      assert.ok(
        categories.includes(hierarchicalCategory),
        `${language} ID ${id} should include ${hierarchicalCategory}`,
      );
      assertAncestors(categories, hierarchicalCategory);
    }
  }
}

test('places the adopted isolated categories under their approved parents', () => {
  for (const language of ['ja', 'en', 'ko']) {
    assertAdoptedHierarchies(language, readCategoryRows(language));
  }
});

test('accepts future English and Korean synchronization of migrated IDs', () => {
  assertAdoptedHierarchies('en', [
    { ID: '0900', Category: 'Body Type,Body Type/Tall' },
    { ID: '0903', Category: 'Condition,Condition/Captive' },
  ]);
  assertAdoptedHierarchies('ko', [
    { ID: '0900', Category: '체형,체형/장신' },
    { ID: '0903', Category: '상태,상태/갇힌 몸' },
  ]);
});

test('keeps the explicitly rejected categories at the root level', () => {
  const rows = readCategoryRows('ja');
  for (const category of [
    '飲み物',
    '調味料',
    '病気・ウイルス',
    '頂に立つ者',
    '最強戦士',
    '正体不明のUMAkyo',
    '惑星',
    'まめ',
    'まめAkyo',
  ]) {
    assert.ok(
      rows.some((row) => splitCategories(row.Category).includes(category)),
      `${category} should remain a root category`,
    );
  }
});

test('classifies the spirit horse under Obon instead of New Year', () => {
  const expectations = {
    ja: {
      obon: '季節・行事/お盆',
      spiritHorse: '季節・行事/お盆/精霊馬',
      newYear: '季節・行事/お正月',
    },
    en: {
      obon: 'Season・Event/Obon',
      spiritHorse: 'Season・Event/Obon/Spirit Horse',
      newYear: 'Season・Event/New Year',
    },
    ko: {
      obon: '계절・행사/오봉',
      spiritHorse: '계절・행사/오봉/정령마',
      newYear: '계절・행사/설날',
    },
  };

  for (const [language, expected] of Object.entries(expectations)) {
    const row = readCategoryRows(language).find((record) => record.ID === '0616');
    assert.ok(row, `${language} should include ID 0616`);
    const categories = splitCategories(row.Category);
    assert.ok(categories.includes(expected.obon));
    assert.ok(categories.includes(expected.spiritHorse));
    assert.ok(!categories.includes(expected.newYear));
  }
});

test('keeps the durable battery categories after Electronic is retired', () => {
  const expectations = {
    ja: ['エネルギー', 'エネルギー/電気', '道具・文房具・生活用品'],
    en: ['Energy', 'Energy/Electricity', 'Daily Necessities'],
    ko: ['에너지', '에너지/전기', '도구・문구・생활용품'],
  };

  for (const [language, expectedCategories] of Object.entries(expectations)) {
    const row = readCategoryRows(language).find((record) => record.ID === '0276');
    assert.ok(row, `${language} should include battery ID 0276`);
    const categories = splitCategories(row.Category);
    for (const category of expectedCategories) {
      assert.ok(
        categories.includes(category),
        `${language} battery should include ${category}`,
      );
    }
  }
});

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

  const hierarchyTranslations = [
    ['自然/菌類', 'Nature/Fungus', '자연/균류'],
    ['自然/貝', 'Nature/Shell', '자연/조개'],
    ['器官/骨', 'Body Part/Bone', '기관/뼈'],
    ['技能・特性/四足歩行', 'Skill・Trait/Quadruped', '기능・특성/네발걸음'],
    [
      '技能・特性/合体・変身',
      'Skill・Trait/Transformation',
      '기능・특성/합체・변신',
    ],
    ['技能・特性/頭脳明晰', 'Skill・Trait/Intelligent', '기능・특성/명석한 두뇌'],
    ['体型/高身長', 'Body Type/Tall', '체형/장신'],
    ['状態/睡眠', 'Condition/Sleep', '상태/수면'],
    ['状態/死', 'Condition/Death', '상태/죽음'],
    ['状態/復活', 'Condition/Revival', '상태/부활'],
    ['状態/囚われの身', 'Condition/Captive', '상태/갇힌 몸'],
    [
      '季節・行事/お盆/精霊馬',
      'Season・Event/Obon/Spirit Horse',
      '계절・행사/오봉/정령마',
    ],
    [
      '道具・文房具・生活用品/ばんそうこう',
      'Daily Necessities/Bandage',
      '도구・문구・생활용품/반창고',
    ],
  ];

  for (const [japanese, english, korean] of hierarchyTranslations) {
    assert.equal(englishMap[japanese], english);
    assert.equal(koreanMap[japanese], korean);
  }

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
