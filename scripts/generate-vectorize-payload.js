#!/usr/bin/env node
/**
 * Generate payload for Vectorize Worker `/insert-data`
 * Source: data/akyo-data-ja.json (avatarUrl official)
 * Output: data/vectorize-payload.json
 *
 * Worker expects:
 * { id, nickname, name, category, description, author, url, language }
 * - name         : avatarName
 * - description  : comment
 * - url          : avatarUrl
 * - language     : defaults to 'ja' (adjust if you generate EN data)
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, 'data', 'akyo-data-ja.json');
const outputPath = path.join(rootDir, 'data', 'vectorize-payload.json');

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`入力ファイルがありません: ${path.relative(rootDir, inputPath)}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const items = JSON.parse(raw);

  const payload = items.map((item) => ({
    id: item.id,
    nickname: item.nickname || '',
    name: item.avatarName || '',
    category: item.category || '',
    description: item.comment || '',
    author: item.author || '',
    url: item.avatarUrl || '',
    language: item.language || 'ja',
  }));

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(
    `✅ Generated ${payload.length} records for Vectorize at ${path.relative(rootDir, outputPath)}`
  );
}

if (require.main === module) {
  main();
}
