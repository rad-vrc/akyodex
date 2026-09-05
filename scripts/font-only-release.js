const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://akyodex.com';
const FONT = 'src/fonts/mplus2-variable.subset.woff2';
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ALLOWED = new Set([
  FONT,
  'src/fonts/subset-manifest.json',
  'src/lib/category-canonical.json',
  ...['ja', 'en', 'ko'].flatMap((locale) => [
    `data/akyo-data-${locale}.csv`, `data/akyo-data-${locale}.json`,
  ]),
]);

function inspectFontOnlyChanges(base, target, root = ROOT) {
  if (!COMMIT.test(base) || !COMMIT.test(target)) throw new Error('Expected full 40-character commit IDs');
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['merge-base', '--is-ancestor', base, target]);
  } catch {
    throw new Error('Production must be an ancestor of the font candidate');
  }
  const records = git(['diff', '--no-renames', '--name-status', '-z', base, target, '--']).split('\0');
  const changed = [];
  for (let i = 0; i < records.length - 1; i += 2) {
    const [status, file] = records.slice(i, i + 2);
    if (status !== 'M' || !ALLOWED.has(file)) {
      throw new Error(`Automatic font activation blocked by non-font changes: ${status} ${file}`);
    }
    changed.push(file);
  }
  if (!changed.includes(FONT)) throw new Error('The font binary has not changed; no automatic activation is needed');
  return changed;
}

function parseProductionRevision(response) {
  const tag = response.headers.get('x-akyodex-worker-tag');
  const version = response.headers.get('x-akyodex-worker-version');
  if (response.status !== 200 || !COMMIT.test(tag ?? '') || !VERSION.test(version ?? '')) {
    throw new Error('Production is not a healthy tagged Worker; refusing font activation');
  }
  return { tag, version };
}

function assertProductionUnchanged(expected, current) {
  if (!COMMIT.test(expected.tag ?? '') || !VERSION.test(expected.version ?? '') ||
      expected.tag !== current.tag || expected.version !== current.version) {
    throw new Error('Production changed after the font-only check; refusing activation');
  }
}

function findBuiltFont(root = ROOT) {
  const expected = readFileSync(path.join(root, FONT));
  const directory = '.open-next/assets/_next/static/media';
  const matches = readdirSync(path.join(root, directory)).filter((file) =>
    file.endsWith('.woff2') && readFileSync(path.join(root, directory, file)).equals(expected));
  if (matches.length !== 1) throw new Error('Expected exactly one matching built font');
  return `/_next/static/media/${matches[0]}`;
}

async function verifyFontResponse(response, expected) {
  if (!response.ok) throw new Error(`Deployed font HTTP ${response.status}`);
  if (!Buffer.from(await response.arrayBuffer()).equals(expected)) {
    throw new Error('Deployed font bytes differ from the generated subset');
  }
}

async function verifyFontStylesheet(html, asset, fetchCss = fetch) {
  // Keep the pre-install gate dependency-free; HTML parsing is only needed after deployment.
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html);
  const stylesheets = [...dom.window.document.querySelectorAll('link[rel="stylesheet"][href]')]
    .map((link) => new URL(link.getAttribute('href'), SITE));
  dom.window.close();
  for (const url of stylesheets) {
    if (url.origin !== SITE || !url.pathname.startsWith('/_next/static/')) continue;
    const response = await fetchCss(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Deployed stylesheet HTTP ${response.status}`);
    if ((await response.text()).includes(path.posix.basename(asset))) return;
  }
  throw new Error('Production HTML does not reference the generated font in its stylesheets');
}

async function currentProduction() {
  return parseProductionRevision(await fetch(`${SITE}/zukan`, {
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  }));
}

function output(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main(command) {
  switch (command) {
    case 'gate': {
      const current = await currentProduction();
      const changed = inspectFontOnlyChanges(current.tag, process.env.GITHUB_SHA);
      console.log(`Font-only changes verified: ${changed.join(', ')}`);
      output('base-tag', current.tag);
      output('base-version', current.version);
      break;
    }
    case 'asset':
      output('font-asset', findBuiltFont());
      break;
    case 'assert-base':
      assertProductionUnchanged({
        tag: process.env.FONT_BASE_TAG, version: process.env.FONT_BASE_VERSION,
      }, await currentProduction());
      break;
    case 'verify': {
      const asset = process.env.FONT_ASSET;
      if (!/^\/_next\/static\/media\/[a-zA-Z0-9_.-]+\.woff2$/.test(asset ?? '')) {
        throw new Error('Missing or invalid generated font asset path');
      }
      await verifyFontResponse(await fetch(`${SITE}${asset}`, {
        cache: 'no-store', signal: AbortSignal.timeout(30_000),
      }), readFileSync(path.join(ROOT, FONT)));
      const page = await fetch(`${SITE}/zukan`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (parseProductionRevision(page).tag !== process.env.GITHUB_SHA) {
        throw new Error('Production HTML is not served by the font candidate');
      }
      await verifyFontStylesheet(await page.text(), asset);
      console.log('Production HTML references the exact generated font bytes');
      break;
    }
    default:
      throw new Error('Expected gate, asset, assert-base, or verify');
  }
}

module.exports = { inspectFontOnlyChanges, parseProductionRevision, assertProductionUnchanged, findBuiltFont, verifyFontResponse, verifyFontStylesheet };
if (require.main === module) {
  main(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
