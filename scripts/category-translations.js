/**
 * Category translations (JA -> EN / KO), shared by the EN/KO data generators and tests.
 *
 * Source: `data/category-translations.json`
 *   { "動物": { "en": "Animal", "ko": "동물" }, "動物/うま": { "en": "Animal/Horse", "ko": null }, ... }
 *
 * - Keys are the exact category tokens used in `data/akyo-data-ja.csv` (comma-separated,
 *   hierarchical with `/`). Every token in use must have an entry, but a language may be
 *   `null`: 対訳は任意で、EN/KO はずっと手作業の後付け。必須にすると日本語だけの登録が
 *   できず、他の人にカテゴリを足してもらえない。訳の無い階層は日本語のまま出す
 *   （段ごとのフォールバック）。訳し忘れは生成を止めず、件数を警告として出すだけ。
 *   Entries nobody uses are allowed (a category exists before its first Akyo, and removing
 *   the last Akyo must not break CI); `scripts/category-translations.test.js` only reports them.
 * - The file lives under `data/` rather than `scripts/` so the admin UI can commit new
 *   categories together with their translations, and so the `Sync JSON Data from CSV`
 *   workflow can regenerate EN/KO without a code change.
 */

const fs = require('fs');
const path = require('path');

const LANGUAGES = ['en', 'ko'];
const CATEGORY_TRANSLATIONS_PATH = path.join(__dirname, '..', 'data', 'category-translations.json');

/** Split a CSV Category cell into trimmed, non-empty tokens (full-width comma tolerated). */
function splitCategoryTokens(value) {
  return String(value || '')
    .replace(/、/g, ',')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Load and validate the translation table.
 * Throws when the file is malformed, so a broken edit fails the generator instead of
 * silently producing Japanese tokens in the EN/KO data.
 */
function loadCategoryTranslations(filePath = CATEGORY_TRANSLATIONS_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${filePath}: expected an object keyed by Japanese category`);
  }
  for (const [japanese, entry] of Object.entries(parsed)) {
    if (!japanese.trim() || japanese !== japanese.trim()) {
      throw new Error(`${filePath}: invalid category key ${JSON.stringify(japanese)}`);
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${filePath}: ${JSON.stringify(japanese)} must be an object`);
    }
    for (const language of LANGUAGES) {
      const value = entry[language];
      // 未対訳は null。日本語のまま出すので、生成は止めない
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
        throw new Error(`${filePath}: ${JSON.stringify(japanese)} "${language}" must be a trimmed non-empty string or null`);
      }
    }
  }
  return parsed;
}

/**
 * その言語で表示する名前。訳の無い階層は日本語のまま残す（段ごとのフォールバック）。
 * 訳した分はそのまま活きるので、`植物` が未対訳で `木` が Tree なら `植物/Tree`。
 */
function resolveToken(token, language, translations) {
  // Own properties only: a category named "constructor" or "__proto__" must not resolve
  // to Object.prototype and slip through as a bogus translation.
  const entry = Object.hasOwn(translations, token) ? translations[token] : null;
  const stored = entry ? entry[language] : null;
  if (typeof stored === 'string' && stored) return stored;
  const index = token.lastIndexOf('/');
  const leaf = token.slice(index + 1);
  return index < 0 ? leaf : `${resolveToken(token.slice(0, index), language, translations)}/${leaf}`;
}

/**
 * Translate Category cells one token at a time, remembering every token that still shows
 * Japanese so the caller can report them all at once after the whole file is processed.
 * 対訳は任意なので、欠けていても生成は止めない（`reportMissing` が数を出すだけ）。
 */
function createCategoryTranslator(language, translations = loadCategoryTranslations()) {
  if (!LANGUAGES.includes(language)) throw new Error(`Unsupported language: ${language}`);
  const missing = new Set();
  return {
    missing,
    translate(value) {
      return splitCategoryTokens(value)
        .map((token) => {
          const entry = Object.hasOwn(translations, token) ? translations[token] : null;
          const stored = entry ? entry[language] : null;
          if (typeof stored !== 'string' || !stored) missing.add(token);
          return resolveToken(token, language, translations);
        })
        .join(',');
    },
    /** 訳し忘れを見えるようにするだけ。生成は止めない */
    reportMissing() {
      if (missing.size === 0) return '';
      const tokens = [...missing].sort();
      return `${tokens.length} ${language} category translations are still Japanese: ${tokens.join(', ')}`;
    },
  };
}

module.exports = {
  CATEGORY_TRANSLATIONS_PATH,
  LANGUAGES,
  createCategoryTranslator,
  loadCategoryTranslations,
  splitCategoryTokens,
};
