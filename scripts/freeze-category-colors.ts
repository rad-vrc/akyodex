/**
 * src/lib/category-colors.json を、JA CSV の最上位カテゴリごとに現在表示している色で埋める。
 *
 * 既に載っている名前はそのまま（管理画面の改名で付け替えられる）。無い名前だけ
 * getCategoryColor（キーワード一致 → ハッシュ）の結果を固定する。
 * 実行: npx tsx scripts/freeze-category-colors.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

import { getCategoryColor } from '../src/lib/akyo-data-helpers';
import { serializeCategoryColors, splitCategoryCell, topLevelOf } from '../src/lib/category-operations';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colorsPath = path.join(rootDir, 'src', 'lib', 'category-colors.json');

const rows = parse(fs.readFileSync(path.join(rootDir, 'data', 'akyo-data-ja.csv'), 'utf8'), {
  columns: true,
  skip_empty_lines: true,
  record_delimiter: ['\r\n', '\n', '\r'],
}) as { Category: string }[];

const colors = JSON.parse(fs.readFileSync(colorsPath, 'utf8')) as Record<string, string>;
let added = 0;
for (const row of rows) {
  for (const token of splitCategoryCell(row.Category)) {
    const top = topLevelOf(token);
    if (Object.hasOwn(colors, top)) continue;
    colors[top] = getCategoryColor(top);
    added += 1;
  }
}
fs.writeFileSync(colorsPath, serializeCategoryColors(colors), 'utf8');
console.log(`category-colors.json: ${Object.keys(colors).length} entries (+${added})`);
