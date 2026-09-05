/**
 * Catalog locale ID-set consistency.
 *
 * EN/KO are produced from JA by `sync-akyo-data-en-from-ja.js` /
 * `generate-ko-data.js`. The admin UI writes only to the JA CSV; the
 * `Sync JSON Data from CSV` workflow reruns both generators, but it keeps the
 * previous EN/KO files whenever a category has no entry in
 * `data/category-translations.json`. So a registration with an untranslated
 * category still widens the gap until someone adds the translation.
 *
 * This module only *detects* that drift. It deliberately does not translate,
 * regenerate or repair anything: producing unreviewed translations and writing
 * them to production data would be worse than the drift it is meant to catch.
 *
 * Scope of the check, on purpose:
 * - ID sets across ja/en/ko must be identical (order is irrelevant)
 * - IDs must be unique within a locale
 * - IDs must be 4-digit numbers
 * - Nickname / Comment / Category CONTENT is NOT compared: those legitimately
 *   differ per locale, and world names are intentionally kept in Japanese.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const LOCALES = ['ja', 'en', 'ko'];
const ID_PATTERN = /^\d{4}$/;

function csvPathFor(locale, dataDir) {
  return path.join(dataDir, `akyo-data-${locale}.csv`);
}

/** Read one locale CSV and return its IDs in file order (duplicates preserved). */
function readLocaleIds(locale, dataDir) {
  const file = csvPathFor(locale, dataDir);
  const records = parse(fs.readFileSync(file, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: false,
    record_delimiter: ['\r\n', '\n', '\r'],
    quote: '"',
    escape: '"',
  });
  return records.map((row) => String(row.ID ?? '').trim());
}

function findDuplicates(ids) {
  const seen = new Set();
  const dupes = new Set();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes].sort();
}

/**
 * Compare the three locale catalogs.
 * @returns {{ ok: boolean, counts: Record<string, number>, problems: string[], report: string }}
 */
function checkCatalogLocaleIds(dataDir = path.join(__dirname, '..', 'data')) {
  const idsByLocale = {};
  const counts = {};
  const problems = [];

  for (const locale of LOCALES) {
    const ids = readLocaleIds(locale, dataDir);
    idsByLocale[locale] = ids;
    counts[locale] = ids.length;

    // 空集合同士は「一致」になってしまうので、件数 0 は単独で問題として扱う。
    // ファイルサイズだけの検査（ヘッダー行があれば非空）では素通りする。
    if (ids.length === 0) {
      problems.push(`No records in ${locale.toUpperCase()} (header only or empty)`);
    }

    const dupes = findDuplicates(ids);
    if (dupes.length > 0) {
      problems.push(`Duplicate IDs in ${locale.toUpperCase()}: ${dupes.join(', ')}`);
    }

    const malformed = [...new Set(ids.filter((id) => !ID_PATTERN.test(id)))].sort();
    if (malformed.length > 0) {
      problems.push(
        `Malformed IDs in ${locale.toUpperCase()} (expected 4 digits): ${malformed.map((id) => JSON.stringify(id)).join(', ')}`,
      );
    }
  }

  const jaSet = new Set(idsByLocale.ja);
  for (const locale of ['en', 'ko']) {
    const set = new Set(idsByLocale[locale]);
    const missing = [...jaSet].filter((id) => !set.has(id)).sort();
    const extra = [...set].filter((id) => !jaSet.has(id)).sort();
    if (missing.length > 0) {
      problems.push(`Missing from ${locale.toUpperCase()}: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      problems.push(`Extra in ${locale.toUpperCase()}: ${extra.join(', ')}`);
    }
  }

  // CI では成功時もこのレポートを出すので、見出しは結果に合わせる
  const lines = [problems.length > 0 ? 'Catalog locale ID mismatch:' : 'Catalog locale ID sets match:'];
  for (const locale of LOCALES) {
    lines.push(`${locale.toUpperCase()}: ${counts[locale]}`);
  }
  lines.push(...problems);
  // 「差分なし」を明示して、レポートを読んだ人が
  // 「出力されていない = 見落とし」と誤解しないようにする
  for (const locale of ['en', 'ko']) {
    const key = `Missing from ${locale.toUpperCase()}:`;
    if (!problems.some((p) => p.startsWith(key))) lines.push(`${key} none`);
  }
  for (const locale of ['en', 'ko']) {
    const key = `Extra in ${locale.toUpperCase()}:`;
    if (!problems.some((p) => p.startsWith(key))) lines.push(`${key} none`);
  }

  return {
    ok: problems.length === 0,
    counts,
    problems,
    report: lines.join('\n'),
  };
}

module.exports = { checkCatalogLocaleIds };

// CI から `node scripts/catalog-locale-ids.js` で直接実行できる入口。
// 差分があれば report をそのまま出して非ゼロ終了する（修復は一切しない）。
if (require.main === module) {
  const result = checkCatalogLocaleIds();
  console.log(result.report);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
