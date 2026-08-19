#!/usr/bin/env node
/**
 * Generate payload for Vectorize Worker `/insert-data`
 * Source: data/akyo-data-ja.json (avatarUrl official)
 * Output: data/vectorize-payload.json
 *
 * Worker expects:
 * { id, entryType, nickname, name, category, description, author, url, language }
 * - entryType    : avatar | world
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

function buildPayload(parsed) {
  let items;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    items = parsed.data;
  }

  if (!Array.isArray(items)) {
    return null;
  }

  return items.map((item) => ({
    id: item.id,
    entryType:
      item.entryType === 'world' || /\/world\//iu.test(item.avatarUrl || '')
        ? 'world'
        : 'avatar',
    nickname: item.nickname || '',
    name: item.avatarName || '',
    category: item.category || '',
    description: item.comment || '',
    author: item.author || '',
    url: item.avatarUrl || '',
    language: item.language || 'ja',
  }));
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`入力ファイルがありません: ${path.relative(rootDir, inputPath)}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  const payload = buildPayload(parsed);
  if (!payload) {
    console.error(`入力JSONの形式が不正です: ${path.relative(rootDir, inputPath)}`);
    process.exit(1);
  }

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(
    `✅ Generated ${payload.length} records for Vectorize at ${path.relative(rootDir, outputPath)}`
  );
}

if (require.main === module) {
  main();
}

module.exports = { buildPayload };
