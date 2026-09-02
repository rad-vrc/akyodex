const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { checkCatalogLocaleIds } = require('./catalog-locale-ids');

const HEADER = 'ID,Nickname,AvatarName,Category,Comment,Author,AvatarURL';

/** Build a throwaway data dir with the given IDs per locale. */
function makeFixture(t, idsByLocale) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akyodex-locale-ids-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const [locale, ids] of Object.entries(idsByLocale)) {
    const rows = ids.map((id) => `${id},Nick ${id},Avatar ${id},Animal,,author,https://example.test/${id}`);
    fs.writeFileSync(path.join(dir, `akyo-data-${locale}.csv`), [HEADER, ...rows].join('\r\n') + '\r\n');
  }
  return dir;
}

// --- 実データ -------------------------------------------------------------

test('real catalog data: ja/en/ko share one ID set', () => {
  const result = checkCatalogLocaleIds();

  assert.equal(
    result.ok,
    true,
    `Locale catalogs drifted. EN/KO are generated from JA by hand, so run\n` +
      `  node scripts/sync-akyo-data-en-from-ja.js\n` +
      `  node scripts/generate-ko-data.js\n` +
      `after adding the missing translations, then npm run data:convert.\n\n` +
      result.report,
  );

  assert.equal(result.counts.ja, result.counts.en);
  assert.equal(result.counts.ja, result.counts.ko);
  assert.ok(result.counts.ja > 0);
});

// --- fixture: 正常系 ------------------------------------------------------

test('identical ID sets pass regardless of row order', (t) => {
  const dir = makeFixture(t, {
    ja: ['0001', '0002', '0003'],
    en: ['0003', '0001', '0002'],
    ko: ['0002', '0003', '0001'],
  });

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, true, result.report);
  assert.deepEqual(result.problems, []);
});

// --- fixture: 欠落の検出 ---------------------------------------------------

test('a locale missing the newest ID is reported with that ID', (t) => {
  const dir = makeFixture(t, {
    ja: ['0939', '0940', '0941'],
    en: ['0939', '0940'],
    ko: ['0939', '0940'],
  });

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes('Missing from EN: 0941'), result.report);
  assert.ok(result.problems.includes('Missing from KO: 0941'), result.report);

  // 件数だけでなく、具体的なIDがレポートに出ること
  assert.match(result.report, /^JA: 3$/m);
  assert.match(result.report, /^EN: 2$/m);
  assert.match(result.report, /^KO: 2$/m);
  assert.match(result.report, /Missing from EN: 0941/);
  assert.match(result.report, /Extra in EN: none/);
});

test('extra IDs in a locale are reported separately from missing ones', (t) => {
  const dir = makeFixture(t, {
    ja: ['0001', '0002'],
    en: ['0001', '0003'],
    ko: ['0001', '0002'],
  });

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes('Missing from EN: 0002'), result.report);
  assert.ok(result.problems.includes('Extra in EN: 0003'), result.report);
  assert.ok(!result.problems.some((p) => p.startsWith('Missing from KO')), result.report);
});

// --- fixture: 重複の検出 ---------------------------------------------------

test('duplicate IDs inside one locale fail even when the sets match', (t) => {
  const dir = makeFixture(t, {
    ja: ['0001', '0002'],
    en: ['0001', '0002', '0002'],
    ko: ['0001', '0002'],
  });

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes('Duplicate IDs in EN: 0002'), result.report);
});

// --- fixture: ID書式の検証 -------------------------------------------------

test('non 4-digit IDs are reported as malformed', (t) => {
  const dir = makeFixture(t, {
    ja: ['0001', '12', 'abcd'],
    en: ['0001', '12', 'abcd'],
    ko: ['0001', '12', 'abcd'],
  });

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, false);
  const jaProblem = result.problems.find((p) => p.startsWith('Malformed IDs in JA'));
  assert.ok(jaProblem, result.report);
  assert.match(jaProblem, /"12"/);
  assert.match(jaProblem, /"abcd"/);
});

// --- 副作用がないこと -------------------------------------------------------

test('the check never rewrites the files it inspects', (t) => {
  const dir = makeFixture(t, {
    ja: ['0001', '0002'],
    en: ['0001'],
    ko: ['0001'],
  });
  const before = Object.fromEntries(
    ['ja', 'en', 'ko'].map((l) => [l, fs.readFileSync(path.join(dir, `akyo-data-${l}.csv`), 'utf8')]),
  );

  const result = checkCatalogLocaleIds(dir);
  assert.equal(result.ok, false);

  for (const locale of ['ja', 'en', 'ko']) {
    assert.equal(
      fs.readFileSync(path.join(dir, `akyo-data-${locale}.csv`), 'utf8'),
      before[locale],
      `${locale} CSV must be left untouched — this check reports drift, it does not repair it`,
    );
  }
});
