const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const rootDir = path.resolve(__dirname, '..');

const machineIds = [
  '0024',
  '0028',
  '0072',
  '0078',
  '0147',
  '0148',
  '0373',
  '0375',
  '0397',
  '0511',
  '0524',
  '0585',
  '0820',
];

const weaponIds = [
  '0207',
  '0332',
  '0333',
  '0357',
  '0510',
  '0541',
  '0550',
  '0594',
  '0595',
  '0631',
  '0845',
];

const categoriesByLanguage = {
  ja: {
    legacyCombined: '武器・機械',
    legacyFashion: 'ファッション',
    machine: '機械',
    fashion: 'ファッション・装備',
    weapon: 'ファッション・装備/武器',
    hazard: '危険物',
  },
  en: {
    legacyCombined: 'Military・Weapons',
    legacyFashion: 'Fashion',
    machine: 'Machine',
    fashion: 'Fashion・Equipment',
    weapon: 'Fashion・Equipment/Weapon',
    hazard: 'Hazardous Material',
  },
  ko: {
    legacyCombined: '무기・기계',
    legacyFashion: '패션',
    machine: '기계',
    fashion: '패션・장비',
    weapon: '패션・장비/무기',
    hazard: '위험물',
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

test('splits every approved record into Machine or Fashion Equipment Weapon', () => {
  for (const [language, expected] of Object.entries(categoriesByLanguage)) {
    const rows = readCsvRows(language);
    const rowsById = new Map(rows.map((row) => [row.ID, row]));

    for (const row of rows) {
      const categories = splitCategories(row.Category);
      assert.ok(
        !categories.includes(expected.legacyCombined),
        `${language} ID ${row.ID} still uses ${expected.legacyCombined}`,
      );
      assert.ok(
        !categories.some(
          (category) =>
            category === expected.legacyFashion ||
            category.startsWith(`${expected.legacyFashion}/`),
        ),
        `${language} ID ${row.ID} still uses the old Fashion hierarchy`,
      );
      for (const category of categories.filter(
        (value) => value === expected.fashion || value.startsWith(`${expected.fashion}/`),
      )) {
        assertAncestors(categories, category);
      }
    }

    for (const id of machineIds) {
      const row = rowsById.get(id);
      assert.ok(row, `${language} should include machine ID ${id}`);
      const categories = splitCategories(row.Category);
      assert.ok(categories.includes(expected.machine), `${language} ID ${id} should be Machine`);
      assert.ok(!categories.includes(expected.weapon), `${language} ID ${id} should not be Weapon`);
    }

    for (const id of weaponIds) {
      const row = rowsById.get(id);
      assert.ok(row, `${language} should include weapon ID ${id}`);
      const categories = splitCategories(row.Category);
      assert.ok(categories.includes(expected.weapon), `${language} ID ${id} should be Weapon`);
      assertAncestors(categories, expected.weapon);
      assert.ok(!categories.includes(expected.machine), `${language} ID ${id} should not be Machine`);
    }

    const unassigned = rowsById.get('0611');
    assert.ok(unassigned, `${language} should include unassigned legacy ID 0611`);
    const unassignedCategories = splitCategories(unassigned.Category);
    assert.ok(!unassignedCategories.includes(expected.machine));
    assert.ok(!unassignedCategories.includes(expected.weapon));

    const missile = rowsById.get('0510');
    assert.ok(splitCategories(missile.Category).includes(expected.hazard));
  }
});

test('defines complete translations for the renamed Fashion Equipment hierarchy', () => {
  const englishMap = require('./category-ja-en-map');
  const { CATEGORY_MAP: koreanMap } = require('./category-definitions-ko');
  const translations = [
    ['ファッション・装備', 'Fashion・Equipment', '패션・장비'],
    ['ファッション・装備/なりきり・仮装', 'Fashion・Equipment/Roleplay', '패션・장비/코스프레'],
    ['ファッション・装備/ひげ', 'Fashion・Equipment/Beard', '패션・장비/수염'],
    ['ファッション・装備/ぼうし', 'Fashion・Equipment/Hat', '패션・장비/모자'],
    ['ファッション・装備/フード', 'Fashion・Equipment/Hood', '패션・장비/후드'],
    ['ファッション・装備/マスク', 'Fashion・Equipment/Mask', '패션・장비/마스크'],
    ['ファッション・装備/メガネ', 'Fashion・Equipment/Glasses', '패션・장비/안경'],
    ['ファッション・装備/厚着', 'Fashion・Equipment/Warm Clothing', '패션・장비/두꺼운 옷'],
    ['ファッション・装備/手袋', 'Fashion・Equipment/Gloves', '패션・장비/장갑'],
    ['ファッション・装備/水着', 'Fashion・Equipment/Swimsuit', '패션・장비/수영복'],
    ['ファッション・装備/薄着', 'Fashion・Equipment/Light Clothing', '패션・장비/가벼운 옷'],
    ['ファッション・装備/迷彩', 'Fashion・Equipment/Camouflage', '패션・장비/위장'],
    ['ファッション・装備/髪型', 'Fashion・Equipment/Hair Style', '패션・장비/헤어스타일'],
    ['ファッション・装備/髪型/ちょんまげ', 'Fashion・Equipment/Hair Style/Chonmage', '패션・장비/헤어스타일/상투'],
    ['ファッション・装備/髪型/モヒカン', 'Fashion・Equipment/Hair Style/Mohawk', '패션・장비/헤어스타일/모히칸'],
    ['ファッション・装備/武器', 'Fashion・Equipment/Weapon', '패션・장비/무기'],
  ];

  for (const [japanese, english, korean] of translations) {
    assert.equal(englishMap[japanese], english, `incorrect EN translation for ${japanese}`);
    assert.equal(koreanMap[japanese], korean, `incorrect KO translation for ${japanese}`);
  }
  assert.equal(englishMap['機械'], 'Machine');
  assert.equal(koreanMap['機械'], '기계');
  assert.equal(Object.hasOwn(englishMap, '武器・機械'), false);
  assert.equal(Object.hasOwn(koreanMap, '武器・機械'), false);
  assert.ok(
    !Object.keys(englishMap).some(
      (category) => category === 'ファッション' || category.startsWith('ファッション/'),
    ),
  );
  assert.ok(
    !Object.keys(koreanMap).some(
      (category) => category === 'ファッション' || category.startsWith('ファッション/'),
    ),
  );
});

test('keeps Vectorize aligned with the machine and weapon assignments', () => {
  const records = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'vectorize-payload.json'), 'utf8'),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  for (const record of records) {
    const categories = splitCategories(record.category);
    assert.ok(!categories.includes('武器・機械'));
    assert.ok(!categories.includes('武器・軍事'));
    assert.ok(
      !categories.some(
        (category) => category === 'ファッション' || category.startsWith('ファッション/'),
      ),
    );
  }

  for (const id of machineIds.filter((value) => recordsById.has(value))) {
    const categories = splitCategories(recordsById.get(id).category);
    assert.ok(categories.includes('機械'), `Vectorize ID ${id} should be Machine`);
    assert.ok(!categories.includes('ファッション・装備/武器'));
  }

  for (const id of weaponIds.filter((value) => recordsById.has(value))) {
    const categories = splitCategories(recordsById.get(id).category);
    assert.ok(categories.includes('ファッション・装備/武器'), `Vectorize ID ${id} should be Weapon`);
    assertAncestors(categories, 'ファッション・装備/武器');
    assert.ok(!categories.includes('機械'));
  }

  const missile = recordsById.get('0510');
  assert.ok(missile);
  assert.ok(splitCategories(missile.category).includes('危険物'));
});
