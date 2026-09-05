const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectAssetScripts,
  stripComments,
  assertSameProgram,
} = require('./strip-asset-comments');

const rootDir = path.resolve(__dirname, '..');

function makeAssetsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akyodex-assets-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return dir;
}

test('collects deployable scripts but skips bundler output', (t) => {
  const dir = makeAssetsDir({
    'sw.js': '// worker\n',
    'nested/helper.js': '// helper\n',
    'analytics.mjs': '// module\n',
    'legacy.cjs': '// commonjs\n',
    '_next/static/chunks/app.js': '// already minified\n',
    'catalog/catalog-v1-ja.json': '{}',
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const found = collectAssetScripts(dir).map((p) =>
    path.relative(dir, p).split(path.sep).join('/'),
  );

  assert.deepEqual(found.sort(), [
    'analytics.mjs',
    'legacy.cjs',
    'nested/helper.js',
    'sw.js',
  ]);
});

test('removes line, block and JSDoc comments', async () => {
  const stripped = await stripComments(
    ['/** Doc. */', '// line', 'const a = 1; /* block */', 'console.log(a);'].join('\n'),
  );

  assert.ok(!stripped.includes('Doc.'));
  assert.ok(!stripped.includes('line'));
  assert.ok(!stripped.includes('block'));
  assert.ok(stripped.includes('console.log(a)'));
});

test('keeps comment-like text that lives inside strings', async () => {
  const stripped = await stripComments(
    'const url = "https://akyodex.com/sw.js"; // drop me\nconsole.log(url);',
  );

  assert.ok(stripped.includes('https://akyodex.com/sw.js'));
  assert.ok(!stripped.includes('drop me'));
});

test('preserves identifiers and does not introduce strict mode', async () => {
  const stripped = await stripComments(
    '// header\nconst CACHE_VERSION = "v9";\nfunction getScope() { return CACHE_VERSION; }\n',
  );

  assert.ok(stripped.includes('CACHE_VERSION'));
  assert.ok(stripped.includes('getScope'));
  assert.ok(!stripped.includes('use strict'));
});

test('never inflates an already-minified asset', async () => {
  const minified =
    'function a(x){return x+1}function b(y){return a(y)*2}console.log(b(3));';

  const stripped = await stripComments(minified);

  assert.ok(Buffer.byteLength(stripped) <= Buffer.byteLength(minified));
});

test('rejects a rewrite that changes the program', async () => {
  await assert.rejects(
    () => assertSameProgram('const a = 1;', 'const a = 2;'),
    /changed the program/,
  );
});

test('the shipped service worker survives the rewrite unchanged', async () => {
  const source = fs.readFileSync(path.join(rootDir, 'public', 'sw.js'), 'utf8');
  const stripped = await stripComments(source);

  await assertSameProgram(source, stripped);
  assert.equal(/^\s*(\/\/|\/\*|\*)/m.test(stripped), false);
});
