const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parse } = require('csv-parse/sync');

const rootDir = path.resolve(__dirname, '..');
const correctKChanAuthor = '（Ｋ）けーちゃん';

function readDataFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('maps Japanese body part categories to hierarchical English categories', () => {
  const categoryMap = require('./category-ja-en-map');

  assert.equal(categoryMap['器官/耳'], 'Body Part/Ear');
  assert.equal(categoryMap['器官/歯'], 'Body Part/Teeth');
});

test('keeps K-chan author spelling consistent in tracked data', () => {
  const activeCsvFiles = [
    'data/akyo-data-ja.csv',
    'data/akyo-data-en.csv',
    'data/akyo-data-ko.csv',
  ];
  const dataFiles = [
    ...activeCsvFiles,
    'data/akyo-data-ja.json',
    'data/akyo-data-en.json',
    'data/akyo-data-ko.json',
    'data/vectorize-payload.json',
    'data/akyo-data.csv.bak',
    'data/akyo-data-US.csv.bak',
  ];
  const invalidSpellings = ['＂K＂ ちゃん', '"K" ちゃん', '""K"" ちゃん'];

  for (const filePath of dataFiles) {
    const content = readDataFile(filePath);
    for (const invalidSpelling of invalidSpellings) {
      assert.equal(
        content.includes(invalidSpelling),
        false,
        `${filePath} includes invalid author spelling ${invalidSpelling}`,
      );
    }
  }

  for (const filePath of activeCsvFiles) {
    const rows = parse(readDataFile(filePath), {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: ['\r\n', '\n', '\r'],
    });
    const row = rows.find((record) => record.ID === '0505');
    assert.ok(row, `${filePath} should include Avatar0505`);
    assert.equal(row.Author, correctKChanAuthor);
  }

  for (const language of ['ja', 'en', 'ko']) {
    const filePath = `data/akyo-data-${language}.json`;
    const payload = JSON.parse(readDataFile(filePath));
    const row = payload.data.find((record) => record.id === '0505');
    assert.ok(row, `${filePath} should include Avatar0505`);
    assert.equal(row.author, correctKChanAuthor);
  }

  const vectorizePayload = JSON.parse(readDataFile('data/vectorize-payload.json'));
  const vectorizeRow = vectorizePayload.find((record) => record.id === '0505');
  assert.ok(vectorizeRow, 'data/vectorize-payload.json should include Avatar0505');
  assert.equal(vectorizeRow.author, correctKChanAuthor);
});

test('preserves existing English BoothURL when Japanese CSV lacks BoothURL column', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akyo-sync-en-'));
  const tempScriptsDir = path.join(tempRoot, 'scripts');
  const tempDataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(tempScriptsDir);
  fs.mkdirSync(tempDataDir);

  fs.copyFileSync(
    path.join(rootDir, 'scripts', 'sync-akyo-data-en-from-ja.js'),
    path.join(tempScriptsDir, 'sync-akyo-data-en-from-ja.js'),
  );
  fs.copyFileSync(
    path.join(rootDir, 'scripts', 'category-ja-en-map.js'),
    path.join(tempScriptsDir, 'category-ja-en-map.js'),
  );

  fs.writeFileSync(
    path.join(tempDataDir, 'akyo-data-ja.csv'),
    [
      'ID,Nickname,AvatarName,Category,Comment,Author,AvatarURL,SourceURL,EntryType,DisplaySerial',
      '9999,テストAkyo,test_avatar,動物,,tester,https://vrchat.com/home/avatar/avtr_test,https://vrchat.com/home/avatar/avtr_test,avatar,9999',
      '',
    ].join('\r\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(tempDataDir, 'akyo-data-en.csv'),
    [
      'ID,Nickname,AvatarName,Category,Comment,Author,AvatarURL,SourceURL,EntryType,DisplaySerial,BoothURL',
      '9999,Test Akyo,test_avatar,Animal,,tester,https://vrchat.com/home/avatar/avtr_test,https://vrchat.com/home/avatar/avtr_test,avatar,9999,https://tester.booth.pm/items/9999',
      '',
    ].join('\r\n'),
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    [path.join(tempScriptsDir, 'sync-akyo-data-en-from-ja.js')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: path.join(rootDir, 'node_modules'),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const rows = parse(
    fs.readFileSync(path.join(tempDataDir, 'akyo-data-en.csv'), 'utf8'),
    {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: ['\r\n', '\n', '\r'],
    },
  );

  assert.equal(rows[0].BoothURL, 'https://tester.booth.pm/items/9999');
});
