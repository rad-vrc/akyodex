const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { test } = require('node:test');
const { syncCatalogData } = require('./sync-catalog-data');

const outputs = [
  'data/akyo-data-ja.json', 'data/akyo-data-en.json', 'data/akyo-data-ko.json',
  'data/akyo-data-en.csv', 'data/akyo-data-ko.csv',
  'src/fonts/mplus2-variable.subset.woff2', 'src/fonts/subset-manifest.json',
  'src/lib/category-canonical.json',
];
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
}).trim();
function put(cwd, path, value) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), value);
}
const read = (cwd, path) => readFileSync(join(cwd, path), 'utf8');
function generate(cwd) {
  const value = read(cwd, 'data/akyo-data-ja.csv') + read(cwd, 'data/category-translations.json');
  for (const path of outputs) put(cwd, path, value);
}
function commit(cwd, message) {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'catalog-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  const runner = join(root, 'runner');
  const editor = join(root, 'editor');
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'clone', remote, editor);
  git(editor, 'config', 'user.name', 'Test editor');
  git(editor, 'config', 'user.email', 'editor@example.test');
  git(editor, 'config', 'core.autocrlf', 'false');
  put(editor, 'data/akyo-data-ja.csv', '951\n');
  put(editor, 'data/category-translations.json', 'old-category\n');
  generate(editor);
  commit(editor, 'seed');
  git(editor, 'push', 'origin', 'main');
  git(root, 'clone', remote, runner);
  git(runner, 'config', 'user.name', 'Test sync');
  git(runner, 'config', 'user.email', 'sync@example.test');
  git(runner, 'config', 'core.autocrlf', 'false');
  return { root, remote, runner, editor };
}
function advance(editor, value, generated = false) {
  put(editor, 'data/akyo-data-ja.csv', `${value}\n`);
  if (generated) generate(editor);
  commit(editor, `edit ${value}`);
  git(editor, 'push', 'origin', 'main');
}
function sync(runner, generator = generate) {
  return syncCatalogData({ cwd: runner, generate: generator, retryDelayMs: 0 });
}

test('the previous rebase strategy conflicts on generated JSON', (t) => {
  const { runner, editor } = fixture(t);
  advance(editor, '952');
  git(runner, 'pull', '--ff-only');
  generate(runner);
  commit(runner, 'local generation');
  advance(editor, '953', true);
  assert.throws(() => git(runner, 'push', 'origin', 'main'));
  assert.throws(() => git(runner, 'pull', '--rebase'), (error) => /CONFLICT/.test(error.stdout));
  git(runner, 'rebase', '--abort');
});

test('rejected push regenerates every artifact from latest CSV and translations', async (t) => {
  const { runner, editor, remote } = fixture(t);
  advance(editor, '952');
  let attempts = 0;
  const result = await sync(runner, (cwd) => {
    generate(cwd);
    attempts += 1;
    if (attempts === 1) {
      put(editor, 'data/category-translations.json', 'new-category\n');
      advance(editor, '953', true);
      // Leave a generated artifact stale so the retry must push its own commit.
      put(editor, outputs[0], 'older-generated-json\n');
      commit(editor, 'concurrent generated change');
      git(editor, 'push', 'origin', 'main');
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.pushed, true);
  assert.equal(result.fontChanged, false, 'do not reuse the rejected attempt font flag');
  for (const path of outputs) {
    assert.equal(read(runner, path), '953\nnew-category\n');
    assert.equal(git(remote, 'show', `main:${path}`), '953\nnew-category');
  }
  assert.equal(git(runner, 'rev-parse', 'HEAD^'), git(editor, 'rev-parse', 'HEAD'));
  assert.equal(git(remote, 'rev-parse', 'main'), result.sha);
});

test('retry recomputes font changes that only appear in the newer source', async (t) => {
  const { runner, editor } = fixture(t);
  advance(editor, '952');
  let attempts = 0;
  const result = await sync(runner, (cwd) => {
    generate(cwd);
    attempts += 1;
    if (attempts === 1) {
      put(cwd, outputs[5], '951\nold-category\n');
      advance(editor, '953');
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.fontChanged, true);
});

test('another sync already published the result: retry is a no-op with current artifacts', async (t) => {
  const { runner, editor } = fixture(t);
  advance(editor, '952');
  let attempts = 0;
  const result = await sync(runner, (cwd) => {
    generate(cwd);
    if (++attempts === 1) advance(editor, '953', true);
  });
  assert.equal(attempts, 2);
  assert.equal(result.pushed, false);
  assert.equal(result.changed, false);
  assert.equal(read(runner, outputs[0]), '953\nold-category\n');
});

test('no-op generation still retries if main advances during generation', async (t) => {
  const { runner, editor } = fixture(t);
  let attempts = 0;
  const result = await sync(runner, (cwd) => {
    generate(cwd);
    if (++attempts === 1) advance(editor, '952');
  });
  assert.equal(attempts, 2);
  assert.equal(result.pushed, true);
  assert.equal(read(runner, outputs[0]), '952\nold-category\n');
});

test('continual concurrent edits exhaust the bound without force-pushing stale data', async (t) => {
  const { runner, editor, remote } = fixture(t);
  advance(editor, '952');
  let attempts = 0;
  await assert.rejects(sync(runner, (cwd) => {
    generate(cwd);
    advance(editor, String(953 + attempts++));
  }), /failed after 3 attempts/);
  assert.equal(attempts, 3);
  assert.equal(git(remote, 'rev-parse', 'main'), git(editor, 'rev-parse', 'main'));
  assert.equal(git(remote, 'show', 'main:data/akyo-data-ja.csv'), '955');
});

test('generation failure stops before committing or publishing', async (t) => {
  const { runner, remote } = fixture(t);
  const before = git(remote, 'rev-parse', 'main');
  await assert.rejects(sync(runner, () => { throw new Error('conversion failed'); }), /conversion failed/);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});

test('dirty checkout is refused without discarding user changes', async (t) => {
  const { runner } = fixture(t);
  put(runner, 'notes.txt', 'keep me');
  await assert.rejects(sync(runner), /clean checkout/);
  assert.equal(read(runner, 'notes.txt'), 'keep me');
});

test('generation cannot stage changes to the original CSV', async (t) => {
  const { runner, remote } = fixture(t);
  const before = git(remote, 'rev-parse', 'main');
  await assert.rejects(sync(runner, (cwd) => {
    put(cwd, 'data/akyo-data-ja.csv', 'unexpected edit');
    git(cwd, 'add', '.');
  }), /outside the catalog output allowlist/);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});
