/**
 * Category translations (JA -> EN / KO), shared by the EN/KO data generators and tests.
 *
 * Source: `data/category-translations.json`
 *   { "動物": { "en": "Animal", "ko": "동물" }, "動物/うま": { "en": "Animal/Horse", "ko": "동물/말" }, ... }
 *
 * - Keys are the exact category tokens used in `data/akyo-data-ja.csv` (comma-separated,
 *   hierarchical with `/`). Every token in use must have an entry. Entries nobody uses are
 *   allowed (a category exists before its first Akyo, and removing the last Akyo must not
 *   break CI); `scripts/category-translations.test.js` only reports them.
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
    for (const language of LANGUAGES) {
      const value = entry?.[language];
      if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
        throw new Error(`${filePath}: ${JSON.stringify(japanese)} needs a non-empty "${language}" translation`);
      }
    }
  }
  return parsed;
}

/**
 * Translate Category cells one token at a time, remembering every token without a
 * translation so the caller can report them all at once after the whole file is processed.
 */
function createCategoryTranslator(language, translations = loadCategoryTranslations()) {
  if (!LANGUAGES.includes(language)) throw new Error(`Unsupported language: ${language}`);
  const missing = new Set();
  return {
    missing,
    translate(value) {
      return splitCategoryTokens(value)
        .map((token) => {
          // Own properties only: a category named "constructor" or "__proto__" must not
          // resolve to Object.prototype and slip through as an empty translation.
          if (!Object.hasOwn(translations, token)) {
            missing.add(token);
            return token;
          }
          return translations[token][language];
        })
        .join(',');
    },
    assertComplete() {
      if (missing.size === 0) return;
      const tokens = [...missing].sort();
      throw new Error(
        `Missing ${language} category translations (${tokens.length}). ` +
          `Add them to data/category-translations.json:\n${tokens.map((token) => `- ${token}`).join('\n')}`,
      );
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
