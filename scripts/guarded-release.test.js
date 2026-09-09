const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  FONT,
  COLORS,
  requiredFileFor,
  inspectGuardedChanges,
  parseProductionRevision,
  assertProductionUnchanged,
  findBuiltFont,
  verifyFontResponse,
  verifyFontStylesheet,
} = require('./guarded-release.js');

// フォントの再生成に付いてくるもの。対訳表はカテゴリを作ると動くが、実行時に GitHub から
// 読むだけでバンドルには入らないので、フォントの自動追従を止める理由にはならない
const SYNC_OUTPUTS = [
  FONT,
  'src/fonts/subset-manifest.json',
  'data/akyo-data-ja.csv',
  'data/akyo-data-ja.json',
  'src/lib/category-canonical.json',
  'data/category-translations.json',
];
const SHA = 'a'.repeat(40);
const VERSION = 'a04aec5d-8266-4a56-89b6-a38c353995a6';

function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'akyo-guarded-release-'));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  const write = (file, body = 'updated') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  };
  for (const file of [...SYNC_OUTPUTS, COLORS]) write(file, 'before');
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  return { root, git, write, commit, base };
}

test('maps each guarded action to the file it must replace', () => {
  assert.equal(requiredFileFor('activate-fonts'), FONT);
  assert.equal(requiredFileFor('activate-colors'), COLORS);
  for (const invalid of [undefined, '', 'activate', 'upload']) {
    assert.throws(() => requiredFileFor(invalid), /GUARDED_ACTION/);
  }
});

test('permits regenerated fonts with catalog sync outputs', (t) => {
  const r = repository(t);
  for (const file of SYNC_OUTPUTS) r.write(file);
  const changes = inspectGuardedChanges(r.base, r.commit(), FONT, r.root);
  assert.ok(changes.includes(FONT));
  assert.equal(changes.length, SYNC_OUTPUTS.length);
});

// カテゴリを 1 つ作ると対訳表が動く。除いておくと、そのあと最初のフォント再生成が
// 必ずゲートで止まり、新しい字が本番に出ないまま残る
test('permits a category created between production and the font candidate', (t) => {
  const r = repository(t);
  r.write('data/category-translations.json');
  const afterCategory = r.commit();
  r.write(FONT);
  r.write('src/fonts/subset-manifest.json');
  const changes = inspectGuardedChanges(r.base, r.commit(), FONT, r.root);
  assert.deepEqual([...changes].sort(), [
    'data/category-translations.json', FONT, 'src/fonts/subset-manifest.json',
  ].sort());
  // 対訳表だけが動いた時点では、まだ差し替えるフォントが無い
  assert.throws(() => inspectGuardedChanges(r.base, afterCategory, FONT, r.root), /has not changed/);
});

// 管理画面の色替えは CSV も対訳も動かさず、文字も増やさないので、フォントの自動追従にも
// カタログの自動反映にも乗らない。この 1 ファイルだけで activate できないと、色を変えても
// 反映されないまま残り、しかも次のフォント自動追従までそこで止まる
test('activates a colour change the admin screen made on its own', (t) => {
  const r = repository(t);
  r.write(COLORS);
  const changes = inspectGuardedChanges(r.base, r.commit(), COLORS, r.root);
  assert.deepEqual(changes, [COLORS]);
});

// 色の activate でも WOFF2 が一緒に動いていることはある。ワークフローはこの戻り値から
// font-changed を作ってフォント固有の検証を回すので、action 名では分岐できない
test('a colour activation still reports the font when the font moved too', (t) => {
  const r = repository(t);
  r.write(COLORS);
  r.write(FONT);
  const changed = inspectGuardedChanges(r.base, r.commit(), COLORS, r.root);
  assert.ok(changed.includes(FONT), 'フォントの変更を握り潰してはいけない');
  assert.ok(changed.includes(COLORS));
});

test('lets a colour change ride along with a font release, and stops blocking it', (t) => {
  const r = repository(t);
  r.write(COLORS);
  const afterRecolor = r.commit();
  r.write(FONT);
  const both = r.commit();
  // フォント側から見ても色は障害物にならない
  assert.deepEqual([...inspectGuardedChanges(r.base, both, FONT, r.root)].sort(), [COLORS, FONT].sort());
  // 色だけ動いた時点でフォントを差し替える理由は無い
  assert.throws(() => inspectGuardedChanges(r.base, afterRecolor, FONT, r.root), /has not changed/);
  // 逆に、フォントだけ動いた差分で色の activate を名乗ってはいけない
  const r2 = repository(t);
  r2.write(FONT);
  assert.throws(() => inspectGuardedChanges(r2.base, r2.commit(), COLORS, r2.root), /has not changed/);
});

test('rejects application, dependency, configuration and workflow changes even with a new font', (t) => {
  for (const file of ['src/app/layout.tsx', 'package-lock.json', 'wrangler.workers.production.jsonc', '.github/workflows/deploy-cloudflare-workers-production.yml']) {
    const r = repository(t);
    r.write(file, 'original');
    const base = r.commit();
    r.write(FONT);
    r.write(file);
    assert.throws(() => inspectGuardedChanges(base, r.commit(), FONT, r.root), /outside the allow-list/);
  }
});

// 色替えのコミットがコード変更と同じ範囲に入っていたら、自動では載せない
test('rejects a colour change bundled with application code', (t) => {
  const r = repository(t);
  r.write('src/lib/akyo-data-helpers.ts', 'original');
  const base = r.commit();
  r.write(COLORS);
  r.write('src/lib/akyo-data-helpers.ts');
  assert.throws(() => inspectGuardedChanges(base, r.commit(), COLORS, r.root), /outside the allow-list/);
});

test('rejects data-only changes and already active fonts', (t) => {
  const r = repository(t);
  assert.throws(() => inspectGuardedChanges(r.base, r.base, FONT, r.root), /has not changed/);
  r.write('data/akyo-data-ja.json');
  assert.throws(() => inspectGuardedChanges(r.base, r.commit(), FONT, r.root), /has not changed/);
});

test('rejects removal of a catalog file', (t) => {
  const r = repository(t);
  r.write(FONT);
  rmSync(path.join(r.root, 'data/akyo-data-ja.csv'));
  assert.throws(() => inspectGuardedChanges(r.base, r.commit(), FONT, r.root), /outside the allow-list/);
});

test('rejects stale and divergent candidates, rather than rolling production backward', (t) => {
  const r = repository(t);
  r.write(FONT);
  const current = r.commit();
  assert.throws(() => inspectGuardedChanges(current, r.base, FONT, r.root), /ancestor/);
  r.git('checkout', '-b', 'divergent', r.base);
  r.write(FONT, 'different');
  assert.throws(() => inspectGuardedChanges(current, r.commit(), FONT, r.root), /ancestor/);
  assert.throws(() => inspectGuardedChanges('--help', current, FONT, r.root), /40-character/);
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
