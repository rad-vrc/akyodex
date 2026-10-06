import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'csv-parse/sync';
import { categoriesForFilterPanel, extractCategories, getCategoryColor, groupCategoriesByParent } from '../src/lib/akyo-data-helpers';
import { filterCatalog } from '../src/lib/catalog-filter';
import { summarizeCategories } from '../src/lib/category-operations';
import type { CategoryTranslations } from '../src/lib/category-operations';
import type { AkyoData } from '../src/types/akyo';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const translations: CategoryTranslations = JSON.parse(read('data/category-translations.json'));
const colors = JSON.parse(read('src/lib/category-colors.json'));

// Reviewed selections from the 2026-10-06 audit. IDs are internal, not displaySerial.
const groups = {
  '国/アメリカ': { en: 'Country/United States', ko: '나라/미국', ids: '0639'.split(' ') },
  '国/イギリス': { en: 'Country/United Kingdom', ko: '나라/영국', ids: '0314'.split(' ') },
  '国/イタリア': { en: 'Country/Italy', ko: '나라/이탈리아', ids: '0071 0236'.split(' ') },
  '国/エジプト': { en: 'Country/Egypt', ko: '나라/이집트', ids: '0074 0117 0462'.split(' ') },
  '国/オランダ': { en: 'Country/Netherlands', ko: '나라/네덜란드', ids: '0626'.split(' ') },
  '国/ギリシャ': { en: 'Country/Greece', ko: '나라/그리스', ids: '0406 0477'.split(' ') },
  '国/タイ王国': { en: 'Country/Thailand', ko: '나라/태국', ids: '0942'.split(' ') },
  '国/フランス': { en: 'Country/France', ko: '나라/프랑스', ids: '0477 0577 0960'.split(' ') },
  '国/ベルギー': { en: 'Country/Belgium', ko: '나라/벨기에', ids: '0080'.split(' ') },
  '国/ポーランド': { en: 'Country/Poland', ko: '나라/폴란드', ids: '0077'.split(' ') },
  '国/メキシコ': { en: 'Country/Mexico', ko: '나라/멕시코', ids: '0085'.split(' ') },
  '国/ロシア': { en: 'Country/Russia', ko: '나라/러시아', ids: '0837'.split(' ') },
  '国/中国': { en: 'Country/China', ko: '나라/중국', ids: '0286 0450'.split(' ') },
  '国/日本': { en: 'Country/Japan', ko: '나라/일본', ids: '0054 0059 0115 0133 0148 0162 0165 0170 0172 0175 0197 0203 0213 0214 0219 0227 0228 0245 0246 0266 0268 0270 0277 0283 0289 0290 0292 0310 0316 0317 0322 0323 0331 0336 0340 0341 0342 0344 0360 0361 0365 0366 0368 0369 0376 0383 0388 0389 0395 0405 0418 0426 0441 0451 0458 0459 0460 0461 0470 0471 0473 0478 0537 0540 0542 0557 0576 0640 0643 0680 0685 0699 0723 0737 0746 0771 0779 0811 0813 0829 0830 0836 0840 0867 0875 0889 0892 0893 0916 0946 0951 0965 0981 1953 2034 2035'.split(' ') },
};
const parents = { ja: '国', en: 'Country', ko: '나라' };
const expectedById = new Map<string, string[]>();
for (const [country, group] of Object.entries(groups)) {
  for (const id of group.ids) expectedById.set(id, [...(expectedById.get(id) ?? []), country]);
}

test('country definitions use complete English and Korean paths under the existing parent', () => {
  assert.deepEqual(translations['国'], { en: parents.en, ko: parents.ko });
  for (const [country, { en, ko }] of Object.entries(groups)) {
    assert.deepEqual(translations[country], { en, ko });
    for (const localized of [country, en, ko]) {
      assert.equal(getCategoryColor(localized), colors['国'], localized);
    }
  }
});

for (const lang of ['ja', 'en', 'ko'] as const) {
  test(lang + ': audited country assignments agree across CSV, JSON, filters and badges', () => {
    const rows = parse<Record<string, string>>(read('data/akyo-data-' + lang + '.csv'), { columns: true, skip_empty_lines: true });
    const catalog: AkyoData[] = JSON.parse(read('data/akyo-data-' + lang + '.json')).data;
    const csvById = new Map(rows.map(row => [row.ID, row]));
    const catalogById = new Map(catalog.map(row => [row.id, row]));
    const options = categoriesForFilterPanel(extractCategories(catalog));
    assert.equal(expectedById.size, 115);
    assert.ok(options.includes(parents[lang]));
    for (const [country, group] of Object.entries(groups)) {
      const localized = lang === 'ja' ? country : group[lang];
      assert.ok(options.includes(localized), localized);
      const filteredIds = new Set(filterCatalog(catalog, { categories: [localized] }).map(row => row.id));
      for (const id of group.ids) assert.ok(filteredIds.has(id), lang + ':' + id);
    }
    for (const [id, countries] of expectedById) {
      const csv = csvById.get(id);
      const item = catalogById.get(id);
      assert.ok(csv && item, id);
      assert.equal(item.category, csv.Category, id);
      const tokens = item.category.split(',');
      assert.equal(new Set(tokens).size, tokens.length, id);
      assert.ok(tokens.includes(parents[lang]), id);
      for (const country of countries) {
        assert.ok(tokens.includes(lang === 'ja' ? country : translations[country][lang]!), id + ':' + country);
      }
      const badgeGroups = groupCategoriesByParent(tokens).filter(group => group.parent === parents[lang]);
      assert.equal(badgeGroups.length, 1, id);
      assert.ok(badgeGroups[0].children.length >= countries.length, id);
    }
    assert.equal(catalogById.get('0837')!.displaySerial, '0765');
    assert.equal(catalogById.get('1953')!.entryType, 'world');
    assert.equal(catalogById.get('1953')!.displaySerial, '0118');
  });
}

test('admin summaries expose the country definitions and matching per-country counts', () => {
  const [header, ...records]: string[][] = parse(read('data/akyo-data-ja.csv'), { skip_empty_lines: true });
  const summaries = summarizeCategories({ header, records, translations, colors });
  for (const [country, { en, ko, ids }] of Object.entries(groups)) {
    const summary = summaries.find(row => row.path === country);
    assert.ok(summary, country);
    assert.equal(summary.enDisplay, en);
    assert.equal(summary.koDisplay, ko);
    assert.ok(summary.count >= ids.length, country);
  }
});
