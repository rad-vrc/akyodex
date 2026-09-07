const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const {
  CATEGORY_TRANSLATIONS_PATH,
  LANGUAGES,
  createCategoryTranslator,
  loadCategoryTranslations,
  splitCategoryTokens,
} = require('./category-translations');

const rootDir = path.resolve(__dirname, '..');

function readCategoryRows(language) {
  return parse(fs.readFileSync(path.join(rootDir, 'data', `akyo-data-${language}.csv`), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    record_delimiter: ['\r\n', '\n', '\r'],
  });
}

function writeTempTranslations(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akyo-category-translations-'));
  const file = path.join(dir, 'category-translations.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Loader / translator behaviour (synthetic data)
// ---------------------------------------------------------------------------

test('translates each token and joins with a plain comma', () => {
  const translator = createCategoryTranslator('en', {
    '動物': { en: 'Animal', ko: '동물' },
    '動物/うま': { en: 'Animal/Horse', ko: '동물/말' },
  });
  assert.equal(translator.translate(' 動物 ,動物/うま、'), 'Animal,Animal/Horse');
  assert.equal(translator.translate(''), '');
  assert.equal(translator.reportMissing(), '');
});

test('未対訳は日本語のまま出し、生成は止めずに件数だけ知らせる', () => {
  // 対訳は任意。必須にすると日本語だけの登録ができず、他の人にカテゴリを足してもらえない
  const translator = createCategoryTranslator('ko', { '動物': { en: 'Animal', ko: '동물' } });
  assert.equal(translator.translate('動物,色/赤'), '동물,色/赤');
  assert.equal(translator.translate('乗り物'), '乗り物');
  assert.match(translator.reportMissing(), /2 ko category translations are still Japanese/);
  assert.match(translator.reportMissing(), /乗り物, 色\/赤/);
});

test('訳した階層は活き、訳の無い階層だけ日本語で残る', () => {
  // 全部揃うまで英語が一切出ない、という状態にはしない（段ごとのフォールバック）
  const translator = createCategoryTranslator('en', {
    '植物': { en: null, ko: null },
    '植物/木': { en: '植物/Tree', ko: null },
  });
  assert.equal(translator.translate('植物,植物/木'), '植物,植物/Tree');
  assert.deepEqual([...translator.missing].sort(), ['植物']);
});

test('treats Object.prototype names as untranslated instead of returning an empty string', () => {
  const translator = createCategoryTranslator('en', { '動物': { en: 'Animal', ko: '동물' } });
  const tokens = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
  assert.equal(translator.translate(tokens.join(',')), tokens.join(','));
  assert.deepEqual([...translator.missing].sort(), [...tokens].sort());
  assert.match(translator.reportMissing(), /4 en category translations are still Japanese/);
});

test('rejects unsupported languages', () => {
  assert.throws(() => createCategoryTranslator('fr', {}), /Unsupported language: fr/);
});

test('rejects malformed translation files, but accepts null for an untranslated language', () => {
  assert.throws(() => loadCategoryTranslations(writeTempTranslations([])), /expected an object/);
  assert.throws(
    () => loadCategoryTranslations(writeTempTranslations({ '動物': { en: ' Animal', ko: '동물' } })),
    /"動物" "en" must be a trimmed non-empty string or null/,
  );
  assert.throws(
    () => loadCategoryTranslations(writeTempTranslations({ '動物': 'Animal' })),
    /"動物" must be an object/,
  );
  assert.throws(
    () => loadCategoryTranslations(writeTempTranslations({ '動物 ': { en: 'Animal', ko: '동물' } })),
    /invalid category key "動物 "/,
  );
  // 対訳は任意。片方だけ、あるいは両方が未対訳のまま登録できる
  assert.deepEqual(
    loadCategoryTranslations(writeTempTranslations({ '動物': { en: 'Animal' }, '植物': { en: null, ko: null } })),
    { '動物': { en: 'Animal' }, '植物': { en: null, ko: null } },
  );
});

// ---------------------------------------------------------------------------
// Invariants of the tracked data
// ---------------------------------------------------------------------------

const translations = loadCategoryTranslations(CATEGORY_TRANSLATIONS_PATH);
const japaneseRows = readCategoryRows('ja');
const usedTokens = new Set(japaneseRows.flatMap((row) => splitCategoryTokens(row.Category)));

test('keeps the translation file sorted by Japanese key so every writer produces the same diff', () => {
  const keys = Object.keys(translations);
  assert.deepEqual(keys, [...keys].sort());
});

test('translates every category token used in the Japanese CSV', () => {
  const missing = [...usedTokens].filter((token) => !Object.hasOwn(translations, token)).sort();
  assert.deepEqual(missing, [], `Add these tokens to data/category-translations.json: ${missing.join(', ')}`);
});

test('reports translation entries the Japanese CSV no longer uses', (t) => {
  // Not a failure: deleting the last Akyo of a category (or creating a category before
  // assigning it) legitimately leaves an entry unused. The admin UI is the place to prune.
  const unused = Object.keys(translations).filter((token) => !usedTokens.has(token));
  t.diagnostic(
    unused.length === 0
      ? 'no unused entries in data/category-translations.json'
      : `unused entries in data/category-translations.json (${unused.length}): ${unused.join(', ')}`,
  );
});

/** 表示名。訳の無い階層は日本語のまま（scripts/category-translations.js と同じ規則） */
function resolveDisplayName(token, language, translations) {
  const stored = Object.hasOwn(translations, token) ? translations[token][language] : null;
  if (typeof stored === 'string' && stored) return stored;
  const separator = token.lastIndexOf('/');
  const leaf = token.slice(separator + 1);
  return separator < 0 ? leaf : `${resolveDisplayName(token.slice(0, separator), language, translations)}/${leaf}`;
}

test('translates a child category under the translation of its parent', () => {
  for (const token of Object.keys(translations)) {
    const separator = token.lastIndexOf('/');
    if (separator < 0) continue;
    const parent = token.slice(0, separator);
    assert.ok(Object.hasOwn(translations, parent), `${token} needs its parent ${parent} in data/category-translations.json`);
    for (const language of LANGUAGES) {
      // 未対訳の階層は日本語のまま表示されるので、その表示名を接頭辞として照合する
      const value = translations[token][language];
      if (value === null || value === undefined) continue;
      const prefix = `${resolveDisplayName(parent, language, translations)}/`;
      assert.ok(
        value.startsWith(prefix),
        `${language} translation of ${token} (${value}) should start with ${prefix}`,
      );
    }
  }
});

test('keeps EN and KO CSV categories equal to the translated Japanese categories', () => {
  for (const language of LANGUAGES) {
    const translator = createCategoryTranslator(language, translations);
    const rowsById = new Map(readCategoryRows(language).map((row) => [row.ID, row]));
    for (const row of japaneseRows) {
      const localized = rowsById.get(row.ID);
      assert.ok(localized, `${language} CSV should contain ID ${row.ID}`);
      assert.equal(
        localized.Category,
        translator.translate(row.Category),
        `${language} ID ${row.ID}: regenerate with scripts/sync-akyo-data-en-from-ja.js / generate-ko-data.js`,
      );
    }
  }
});

test('lists every ancestor of a hierarchical category in every language', () => {
  for (const language of ['ja', ...LANGUAGES]) {
    for (const row of readCategoryRows(language)) {
      const categories = splitCategoryTokens(row.Category);
      for (const category of categories) {
        const parts = category.split('/');
        for (let depth = 1; depth < parts.length; depth += 1) {
          const ancestor = parts.slice(0, depth).join('/');
          assert.ok(
            categories.includes(ancestor),
            `${language} ID ${row.ID}: ${category} needs its ancestor ${ancestor}`,
          );
        }
      }
    }
  }
});
