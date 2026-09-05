const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  inspectFontOnlyChanges,
  parseProductionRevision,
  assertProductionUnchanged,
  findBuiltFont,
  verifyFontResponse,
  verifyFontStylesheet,
} = require('./font-only-release.js');

const FONT = 'src/fonts/mplus2-variable.subset.woff2';
const SHA = 'a'.repeat(40);
const VERSION = 'a04aec5d-8266-4a56-89b6-a38c353995a6';

function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'akyo-font-release-'));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Font test');
  git('config', 'user.email', 'font-test@example.invalid');
  const write = (file, body = 'updated') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  for (const file of [FONT, 'src/fonts/subset-manifest.json', 'data/akyo-data-ja.csv', 'data/akyo-data-ja.json', 'src/lib/category-canonical.json']) write(file, 'before');
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  return { root, git, write, commit, base };
}

test('permits regenerated fonts with catalog sync outputs', (t) => {
  const r = repository(t);
  for (const file of [FONT, 'src/fonts/subset-manifest.json', 'data/akyo-data-ja.csv', 'data/akyo-data-ja.json', 'src/lib/category-canonical.json']) r.write(file);
  const changes = inspectFontOnlyChanges(r.base, r.commit(), r.root);
  assert.ok(changes.includes(FONT));
  assert.equal(changes.length, 5);
});

test('rejects application, dependency, configuration and workflow changes even with a new font', (t) => {
  for (const file of ['src/app/layout.tsx', 'package-lock.json', 'wrangler.workers.production.jsonc', '.github/workflows/deploy-cloudflare-workers-production.yml']) {
    const r = repository(t);
    r.write(file, 'original');
    const base = r.commit();
    r.write(FONT);
    r.write(file);
    assert.throws(() => inspectFontOnlyChanges(base, r.commit(), r.root), /non-font changes/);
  }
});

test('rejects data-only changes and already active fonts', (t) => {
  const r = repository(t);
  assert.throws(() => inspectFontOnlyChanges(r.base, r.base, r.root), /font binary has not changed/);
  r.write('data/akyo-data-ja.json');
  assert.throws(() => inspectFontOnlyChanges(r.base, r.commit(), r.root), /font binary has not changed/);
});

test('rejects removal of a catalog file', (t) => {
  const r = repository(t);
  r.write(FONT);
  rmSync(path.join(r.root, 'data/akyo-data-ja.csv'));
  assert.throws(() => inspectFontOnlyChanges(r.base, r.commit(), r.root), /non-font changes/);
});

test('rejects stale and divergent candidates, rather than rolling production backward', (t) => {
  const r = repository(t);
  r.write(FONT);
  const current = r.commit();
  assert.throws(() => inspectFontOnlyChanges(current, r.base, r.root), /ancestor/);
  r.git('checkout', '-b', 'divergent', r.base);
  r.write(FONT, 'different');
  assert.throws(() => inspectFontOnlyChanges(current, r.commit(), r.root), /ancestor/);
  assert.throws(() => inspectFontOnlyChanges('--help', current, r.root), /40-character/);
});

test('requires a healthy Worker with exact commit and version headers', () => {
  const response = (status = 200, tag = SHA, version = VERSION) => new Response('', {
    status, headers: { 'X-Akyodex-Worker-Tag': tag, 'X-Akyodex-Worker-Version': version },
  });
  const current = parseProductionRevision(response());
  assert.deepEqual(current, { tag: SHA, version: VERSION });
  for (const invalid of [response(503), response(200, ''), response(200, SHA, ''), response(200, 'main')]) {
    assert.throws(() => parseProductionRevision(invalid), /healthy tagged Worker/);
  }
  assert.doesNotThrow(() => assertProductionUnchanged(current, current));
  assert.throws(() => assertProductionUnchanged(current, { ...current, tag: 'b'.repeat(40) }), /changed/);
  assert.throws(() => assertProductionUnchanged(current, { ...current, version: 'different' }), /changed/);
});

test('selects only the built WOFF2 matching the generated font bytes', (t) => {
  const r = repository(t);
  const media = '.open-next/assets/_next/static/media';
  r.write(`${media}/other.woff2`, 'unrelated');
  r.write(`${media}/mplus2.woff2`, 'before');
  const asset = findBuiltFont(r.root);
  assert.equal(asset, '/_next/static/media/mplus2.woff2');
  r.write(`${media}/mplus2.woff2`, 'wrong');
  assert.throws(() => findBuiltFont(r.root), /matching built font/);
  r.write(`${media}/mplus2.woff2`, 'before');
  r.write(`${media}/duplicate.woff2`, 'before');
  assert.throws(() => findBuiltFont(r.root), /exactly one/);
});

test('verifies deployed bytes and fails on HTTP errors or an old font', async () => {
  await verifyFontResponse(new Response('new font'), Buffer.from('new font'));
  await assert.rejects(() => verifyFontResponse(new Response('old font'), Buffer.from('new font')), /font bytes/);
  await assert.rejects(() => verifyFontResponse(new Response('missing', { status: 404 }), Buffer.from('new font')), /HTTP 404/);
});

test('requires the live page stylesheet to reference the new font, not just an uploaded asset', async () => {
  const html = '<link rel="stylesheet" href="/_next/static/app.css">';
  const asset = '/_next/static/media/new.woff2';
  const css = async (url) => {
    assert.equal(url.href, 'https://akyodex.com/_next/static/app.css');
    return new Response('@font-face { src: url(./media/new.woff2) }');
  };
  await verifyFontStylesheet(html, asset, css);
  await assert.rejects(() => verifyFontStylesheet(html, asset, async () => new Response('old.woff2')), /does not reference/);
  await assert.rejects(() => verifyFontStylesheet('<link rel="stylesheet" href="https://example.invalid/app.css">', asset, css), /does not reference/);
});
