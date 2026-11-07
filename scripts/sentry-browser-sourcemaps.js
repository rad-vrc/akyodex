#!/usr/bin/env node
/**
 * ブラウザー用のソースマップを Sentry に上げ、配信物（.open-next/assets）から消す。
 *
 * 本番・ステージングのビルドは AKYODEX_BROWSER_SOURCEMAPS=1 で .map を作る（next.config.ts）。
 * ここで次の順に処理する。
 *   1. Sentry にリリース（Worker の版の印 = git のコミット）を作り、_next/static の .js と .map を上げる。
 *      ファイルの名前は `app:///_next/static/...`。ブラウザーの SDK がスタックの場所を
 *      `<origin>/_next/...` → `app:///_next/...` に書き換えて送るので（sentry-client-init.ts）、その名前に合わせる。
 *      Debug ID 方式は配信する JS に短いコードを足すので使わず、リリース名とファイルの場所で対応づける。
 *   2. 配信物から .map を消し、.js・.css の末尾の sourceMappingURL のコメントも消す。
 *      配信する JS・CSS は、ソースマップを作らないときと同じ大きさになる。
 *   3. .map と sourceMappingURL が 1 つも残っていないことを確かめる。残っていれば失敗する（ソースを公開しないため）。
 *
 * Sentry への送信に失敗しても（トークンがない・権限が足りないなど）デプロイは止めず、GitHub Actions の
 * 警告を出す。2・3 は必ず行う。
 *
 * 使い方: node scripts/sentry-browser-sourcemaps.js --release <git のコミット> [--assets .open-next/assets]
 * Sentry へ送るには SENTRY_AUTH_TOKEN・SENTRY_ORG・SENTRY_PROJECT が要る（sentry-cli が環境変数から読む）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const URL_PREFIX = 'app:///_next/static';
const GIT_SHA = /^[0-9a-f]{40}$/;
// ファイルの最後にある参照のコメントだけを消す（途中のものは触らない。位置がずれないように末尾だけ）
const TRAILING_JS_SOURCEMAP_COMMENT = /\n?\/\/# sourceMappingURL=[^\n]*\s*$/;
const TRAILING_CSS_SOURCEMAP_COMMENT = /\n?\/\*# sourceMappingURL=[^*]*\*\/\s*$/;

function walkFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile()) found.push(entryPath);
    }
  };
  walk(dir);
  return found.sort();
}

function parseArgs(argv) {
  const args = { assets: path.join('.open-next', 'assets') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--release') args.release = argv[++i];
    else if (argv[i] === '--assets') args.assets = argv[++i];
    else throw new Error(`知らない引数: ${argv[i]}`);
  }
  if (!GIT_SHA.test(args.release ?? '')) {
    throw new Error('--release には git のコミット（40 桁の 16 進）を渡す');
  }
  return args;
}

/** Sentry に上げるための sentry-cli の引数の並び */
function uploadCommands(release, staticDir) {
  return [
    ['releases', 'new', release],
    ['sourcemaps', 'upload', '--release', release, '--url-prefix', URL_PREFIX, '--ext', 'js', '--ext', 'map', staticDir],
  ];
}

function runSentryCli(args) {
  const cli = require.resolve('@sentry/cli/bin/sentry-cli');
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env: process.env });
  return result.status === 0;
}

/** 上げられる条件がそろっていれば上げる。上げたかどうかを返す（失敗はデプロイを止めない） */
function uploadToSentry(release, staticDir, { env = process.env, run = runSentryCli, log = console } = {}) {
  const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].filter((name) => !env[name]);
  if (missing.length > 0) {
    log.warn(`::warning::Sentry にソースマップを上げなかった（${missing.join('・')} がない）`);
    return false;
  }
  for (const args of uploadCommands(release, staticDir)) {
    if (!run(args)) {
      log.warn(`::warning::Sentry へのソースマップの送信に失敗した（sentry-cli ${args.slice(0, 2).join(' ')}）。配信物の後片付けは続ける`);
      return false;
    }
  }
  return true;
}

/** .map を消し、.js・.css の末尾の参照のコメントを消す */
function removeSourceMaps(assetsDir) {
  let removedMaps = 0;
  let strippedComments = 0;
  for (const file of walkFiles(assetsDir)) {
    if (file.endsWith('.map')) {
      fs.rmSync(file);
      removedMaps++;
      continue;
    }
    const pattern = /\.(?:js|mjs|cjs)$/.test(file)
      ? TRAILING_JS_SOURCEMAP_COMMENT
      : file.endsWith('.css')
        ? TRAILING_CSS_SOURCEMAP_COMMENT
        : null;
    if (!pattern) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!pattern.test(text)) continue;
    fs.writeFileSync(file, text.replace(pattern, ''));
    strippedComments++;
  }
  return { removedMaps, strippedComments };
}

/** 配信物に .map と参照のコメントが残っていないかを確かめる。残っているファイルの一覧を返す */
function findLeftoverSourceMaps(assetsDir) {
  return walkFiles(assetsDir).filter((file) => {
    if (file.endsWith('.map')) return true;
    // コードの中に "sourceMappingURL=" という文字列を持つライブラリもあるので、末尾のコメントの形だけを見る
    if (/\.(?:js|mjs|cjs)$/.test(file)) return TRAILING_JS_SOURCEMAP_COMMENT.test(fs.readFileSync(file, 'utf8'));
    if (file.endsWith('.css')) return TRAILING_CSS_SOURCEMAP_COMMENT.test(fs.readFileSync(file, 'utf8'));
    return false;
  });
}

function main(argv, { env = process.env, run = runSentryCli, log = console } = {}) {
  const { release, assets } = parseArgs(argv);
  const staticDir = path.join(assets, '_next', 'static');
  if (!fs.existsSync(staticDir)) {
    throw new Error(`${staticDir} がない。OpenNext のビルドの後に走らせる`);
  }
  const mapCount = walkFiles(assets).filter((file) => file.endsWith('.map')).length;
  if (mapCount === 0) {
    log.warn('::warning::ソースマップが 1 つもない（AKYODEX_BROWSER_SOURCEMAPS=1 でビルドしたか確かめる）。Sentry には上げない');
  }

  const uploaded = mapCount > 0 && uploadToSentry(release, staticDir, { env, run, log });
  const { removedMaps, strippedComments } = removeSourceMaps(assets);
  const leftovers = findLeftoverSourceMaps(assets);
  if (leftovers.length > 0) {
    throw new Error(`配信物にソースマップが残っている: ${leftovers.slice(0, 5).join(', ')}`);
  }
  log.log(
    `ソースマップ ${mapCount} 個（リリース ${release}）: Sentry に${uploaded ? '上げた' : '上げなかった'}。` +
      `配信物から .map ${removedMaps} 個と参照のコメント ${strippedComments} 個を消した`
  );
  return { mapCount, uploaded, removedMaps, strippedComments };
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, uploadCommands, uploadToSentry, removeSourceMaps, findLeftoverSourceMaps, parseArgs };
