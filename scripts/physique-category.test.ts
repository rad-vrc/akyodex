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
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
const translations: CategoryTranslations = JSON.parse(read('data/category-translations.json'));
const colors = JSON.parse(read('src/lib/category-colors.json'));
const names = { ja: '体格・形状・触り心地', en: 'Physique・Shape・Texture', ko: '체격・형태・촉감' };
const retired = new Set(['体型', '形状・触り心地', 'Body Type', 'Shape・Texture', '체형', '형태・촉감']);

test('the merged category retains both sets of children and removes retired definitions', () => {
  assert.deepEqual(translations[names.ja], { en: names.en, ko: names.ko });
  const leaves = ['うろこ', 'さらさら', 'ぬるぬる', 'ふわふわ', 'ぷるぷる', 'ぺらぺら', 'トゲトゲ', 'ムキムキ', 'モサモサ', '丸い', '冷たい', '四角い', '小さい', '柔らかい', '硬い', '粘着質', '豊満', '高身長'];
  for (const leaf of leaves) {
    const entry = translations[`${names.ja}/${leaf}`];
    assert.ok(entry, leaf);
    for (const lang of ['en', 'ko'] as const) assert.ok(entry[lang]?.startsWith(`${names[lang]}/`));
  }
  for (const key of [...Object.keys(translations), ...Object.keys(colors)]) assert.ok(!retired.has(key.split('/')[0]), key);
  for (const name of Object.values(names)) assert.equal(getCategoryColor(name), colors[names.ja]);
});

test('thin is merged into paper-thin in all catalogs, filters, and admin definitions', () => {
  const removed = { ja: `${names.ja}/薄い`, en: `${names.en}/Thin`, ko: `${names.ko}/얇은` };
  const kept = { ja: `${names.ja}/ぺらぺら`, en: `${names.en}/Paper-Thin`, ko: `${names.ko}/종잇장처럼 얇은` };
  assert.equal(translations[removed.ja], undefined);
  assert.deepEqual(translations[kept.ja], { en: kept.en, ko: kept.ko });

  for (const lang of ['ja', 'en', 'ko'] as const) {
    const rows = parse<Record<string, string>>(read(`data/akyo-data-${lang}.csv`), { columns: true, skip_empty_lines: true });
    const catalog: AkyoData[] = JSON.parse(read(`data/akyo-data-${lang}.json`)).data;
    for (const category of [...rows.map(row => row.Category), ...catalog.map(row => row.category)]) {
      assert.ok(!category.split(',').includes(removed[lang]), lang);
    }
    const options = categoriesForFilterPanel(extractCategories(catalog));
    assert.ok(!options.includes(removed[lang]), lang);
    assert.ok(options.includes(kept[lang]), lang);
    const filtered = filterCatalog(catalog, { categories: [kept[lang]] });
    for (const id of ['0027', '0682', '0947', '0948']) {
      assert.ok(filtered.some(row => row.id === id), `${lang} ${id}`);
    }
  }

  const [header, ...records]: string[][] = parse(read('data/akyo-data-ja.csv'), { skip_empty_lines: true });
  const summaries = summarizeCategories({ header, records, translations, colors });
  assert.ok(!summaries.some(row => row.path === removed.ja));
  assert.ok(summaries.some(row => row.path === kept.ja && row.count >= 4));
});

test('shared public and admin filter and badge grouping helpers use the merged category in every locale', () => {
  for (const lang of ['ja', 'en', 'ko'] as const) {
    const rows = parse<Record<string, string>>(read(`data/akyo-data-${lang}.csv`), { columns: true, skip_empty_lines: true });
    const catalog: AkyoData[] = JSON.parse(read(`data/akyo-data-${lang}.json`)).data;
    const csvById = new Map(rows.map((row: Record<string, string>) => [row.ID, row.Category]));
    const options = categoriesForFilterPanel(extractCategories(catalog));
    assert.ok(options.includes(names[lang]));
    for (const row of catalog) {
      assert.deepEqual(new Set(row.category.split(',')), new Set(String(csvById.get(row.id)).split(',')));
      const tokens = row.category.split(',');
      assert.equal(new Set(tokens).size, tokens.length, row.id);
      for (const token of tokens) assert.ok(!retired.has(token.split('/')[0]), `${lang} ${row.id}: ${token}`);
    }
    const filtered = filterCatalog(catalog, { categories: [names[lang]] });
    for (const id of ['0110', '0702', '0900', '0952']) assert.ok(filtered.some(row => row.id === id), `${lang} ${id}`);
    const both = catalog.find(row => row.id === '0702')!;
    const groups = groupCategoriesByParent(both.category.split(','));
    const merged = groups.filter(group => group.parent === names[lang]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].children.length, 2);
  }
});

test('admin category management exposes one parent with EN/KO translations', () => {
  const [header, ...records]: string[][] = parse(read('data/akyo-data-ja.csv'), { skip_empty_lines: true });
  const summaries = summarizeCategories({ header, records, translations, colors });
  assert.ok(!summaries.some(row => retired.has(row.path.split('/')[0])));
  const parent = summaries.find(row => row.path === names.ja)!;
  assert.ok(parent);
  assert.equal(parent.enDisplay, names.en);
  assert.equal(parent.koDisplay, names.ko);
  assert.ok(parent.count > 0);
});
