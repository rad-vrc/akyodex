const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://akyodex.com';
const FONT = 'src/fonts/mplus2-variable.subset.woff2';
const COLORS = 'src/lib/category-colors.json';
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// 管理画面の変更に手動 activate を要求しない、というのが図鑑の原則。データは KV/R2 から
// 配信されるのでそのまま反映されるが、バンドルに入るファイルは activate しないと出ない。
// そこで「これだけしか動いていないなら自動で activate してよい」ファイルを列挙する。
//
// `data/category-translations.json` は実行時に GitHub から読むだけでバンドルに入らない
// （`akyo-csv-snapshot.ts` が持つのはパスの定数）。`src/lib/category-colors.json` は
// `akyo-data-helpers.ts` が import していてバンドルを変えるが、書けるのは管理画面だけで
// 内容は色コードの対応表に限られる（`category-operations.ts` が最上位カテゴリと登録済みの
// 色しか通さない）ので、自動で載せてよい。除いておくと、色を変えた時点で反映されないうえ
// フォントの自動追従までそこで止まる。
const RELEASABLE = new Set([
  FONT,
  COLORS,
  'src/fonts/subset-manifest.json',
  'src/lib/category-canonical.json',
  'data/category-translations.json',
  ...['ja', 'en', 'ko'].flatMap((locale) => [
    `data/akyo-data-${locale}.csv`, `data/akyo-data-${locale}.json`,
  ]),
]);

/** workflow_dispatch の action 名 → その action が差し替えるファイル */
const REQUIRED_BY_ACTION = { 'activate-fonts': FONT, 'activate-colors': COLORS };

function requiredFileFor(action) {
  const required = REQUIRED_BY_ACTION[action ?? ''];
  if (!required) {
    throw new Error(`Expected GUARDED_ACTION to be one of ${Object.keys(REQUIRED_BY_ACTION).join(', ')}`);
  }
  return required;
}

/**
 * 本番 `base` と候補 `target` の差分が自動 activate してよい範囲に収まっているか。
 *
 * `required` が動いていることまで確かめるのは、何も差し替えるものが無いのに
 * activate して、main にある未 activate の変更を巻き込むのを防ぐため。
 */
function inspectGuardedChanges(base, target, required, root = ROOT) {
  if (!COMMIT.test(base) || !COMMIT.test(target)) throw new Error('Expected full 40-character commit IDs');
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['merge-base', '--is-ancestor', base, target]);
  } catch {
    throw new Error('Production must be an ancestor of the candidate');
  }
  const records = git(['diff', '--no-renames', '--name-status', '-z', base, target, '--']).split('\0');
  const changed = [];
  for (let i = 0; i < records.length - 1; i += 2) {
    const [status, file] = records.slice(i, i + 2);
    if (status !== 'M' || !RELEASABLE.has(file)) {
      throw new Error(`Automatic activation blocked by changes outside the allow-list: ${status} ${file}`);
    }
    changed.push(file);
  }
  if (!changed.includes(required)) {
    throw new Error(`${required} has not changed; no automatic activation is needed`);
  }
  return changed;
}

function parseProductionRevision(response) {
  const tag = response.headers.get('x-akyodex-worker-tag');
  const version = response.headers.get('x-akyodex-worker-version');
  if (response.status !== 200 || !COMMIT.test(tag ?? '') || !VERSION.test(version ?? '')) {
    throw new Error('Production is not a healthy tagged Worker; refusing automatic activation');
  }
  return { tag, version };
}

function assertProductionUnchanged(expected, current) {
  if (!COMMIT.test(expected.tag ?? '') || !VERSION.test(expected.version ?? '') ||
      expected.tag !== current.tag || expected.version !== current.version) {
    throw new Error('Production changed after the guarded check; refusing activation');
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
  // 改行を含む値は GITHUB_OUTPUT の行フォーマットを壊し、後続の行を別の出力として
  // 差し込める。理由文にはコミットのファイル名が入るので、1 行に潰してから書く
  const line = String(value).replace(/[\r\n]+/g, ' ');
  console.log(`${name}=${line}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${line}\n`);
}

async function main(command) {
  switch (command) {
    case 'gate': {
      const required = requiredFileFor(process.env.GUARDED_ACTION);
      const current = await currentProduction();
      const changed = inspectGuardedChanges(current.tag, process.env.GITHUB_SHA, required);
      console.log(`Auto-releasable changes verified: ${changed.join(', ')}`);
      output('base-tag', current.tag);
      output('base-version', current.version);
      // フォント固有の検証を回すかどうかは action 名ではなく実差分で決める。
      // activate-colors のゲートは WOFF2 が一緒に動いていても通すので、action 名で
      // 分岐すると未検証のフォントがそのまま公開される
      output('font-changed', String(changed.includes(FONT)));
      break;
    }
    // 起動側（activate-category-colors.yml）が「今 activate してよいか」を判定するための、
    // 落ちない gate。色の変更がコード変更と同じ push に乗っているのは普通のことなので、
    // 通らなかったときにワークフローを赤くしても意味がない。理由だけ残して false を返す
    case 'gate-report': {
      const required = requiredFileFor(process.env.GUARDED_ACTION);
      try {
        const current = await currentProduction();
        const changed = inspectGuardedChanges(current.tag, process.env.GITHUB_SHA, required);
        console.log(`Auto-releasable changes verified: ${changed.join(', ')}`);
        output('releasable', 'true');
        output('reason', `only auto-releasable files changed (${changed.join(' ')})`);
      } catch (error) {
        output('releasable', 'false');
        output('reason', error.message);
      }
      break;
    }
    case 'asset':
      output('font-asset', findBuiltFont());
      break;
    case 'assert-base':
      assertProductionUnchanged({
        tag: process.env.RELEASE_BASE_TAG, version: process.env.RELEASE_BASE_VERSION,
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
      throw new Error('Expected gate, gate-report, asset, assert-base, or verify');
  }
}

module.exports = { FONT, COLORS, requiredFileFor, inspectGuardedChanges, parseProductionRevision, assertProductionUnchanged, findBuiltFont, verifyFontResponse, verifyFontStylesheet };
if (require.main === module) {
  main(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
