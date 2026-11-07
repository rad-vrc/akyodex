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
 *   2. 配信物から .map を消す。.js・.css の最後の行がまるごと参照のコメント（このビルドの .map を指すもの）なら、
 *      その行も消す（配信する大きさを、ソースマップを作らないときに近づけるため）。
 *   3. .map が残っていれば失敗する（ソースを公開しないため）。
 *
 * ソースが漏れる経路は .map だけとして扱う。productionBrowserSourceMaps は外部の .map を作る設定で、
 * インラインのソースマップ（data: URL）は出さない。参照のコメントが残っても、消した .map を指すだけで中身は出ない。
 *
 * Sentry への送信に失敗しても（トークンがない・権限が足りないなど）デプロイは止めず、GitHub Actions の
 * 警告を出す。2・3 は必ず行う。
 *
 * 使い方: node scripts/sentry-browser-sourcemaps.js --release <git のコミット> [--assets .open-next/assets] [--require-maps]
 * Sentry へ送るには SENTRY_AUTH_TOKEN・SENTRY_ORG・SENTRY_PROJECT が要る（sentry-cli が環境変数から読む）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const URL_PREFIX = 'app:///_next/static';
const GIT_SHA = /^[0-9a-f]{40}$/;
// 参照のコメントを消すのは、最後の行がまるごとそのコメントで、指す先がこのビルドで作られた .map のときだけ。
// 正しい JS・CSS では、最後の行がまるごと文字列やテンプレートの途中になることはない（閉じる記号が後ろに要る）ので、
// 文字列を切り落とさない。途中の行は触らない（位置がずれないように）。`//@` は古い書き方
const JS_REFERENCE_LINE = /^\/\/[#@] sourceMappingURL=([^\s'"`]+)$/;
const CSS_REFERENCE_LINE = /^\/\*[#@] sourceMappingURL=([^\s'"*]+) ?\*\/$/;

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
    // ソースマップが 1 つもなければ失敗する（ビルドの設定の退行を捕まえる。PR の確認のステージングで使う）
    else if (argv[i] === '--require-maps') args.requireMaps = true;
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

const isScriptFile = (file) => /\.(?:js|mjs|cjs)$/.test(file);
const isStyleFile = (file) => file.endsWith('.css');

/** 末尾の空白を除いた最後の行と、その前の部分（改行は \n・\r\n・\r のどれでも） */
function splitLastLine(text) {
  const body = text.replace(/\s+$/, '');
  const index = Math.max(body.lastIndexOf('\n'), body.lastIndexOf('\r'));
  return { head: body.slice(0, index + 1), last: body.slice(index + 1) };
}

/**
 * 最後の行がまるごと参照のコメントで、指す先が mapPaths（このビルドで作られた .map の絶対パス）にあれば、
 * その行を落とした中身を返す。そうでなければ null（触らない）
 */
function withoutReferenceLine(text, file, mapPaths) {
  const pattern = isScriptFile(file) ? JS_REFERENCE_LINE : isStyleFile(file) ? CSS_REFERENCE_LINE : null;
  if (!pattern) return null;
  const { head, last } = splitLastLine(text);
  const match = last.match(pattern);
  if (!match || !mapPaths.has(path.resolve(path.dirname(file), match[1]))) return null;
  // 参照の行の前の空行も落とし、改行 1 つで終える
  const code = head.replace(/\s+$/, '');
  return code === '' ? '' : `${code}\n`;
}

/** .js・.css の最後の参照のコメントを消してから、.map を消す */
function removeSourceMaps(assetsDir) {
  const files = walkFiles(assetsDir);
  const mapPaths = new Set(files.filter((file) => file.endsWith('.map')).map((file) => path.resolve(file)));
  let strippedComments = 0;
  for (const file of files) {
    if (!isScriptFile(file) && !isStyleFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const stripped = withoutReferenceLine(text, path.resolve(file), mapPaths);
    if (stripped === null) continue;
    fs.writeFileSync(file, stripped);
    strippedComments++;
  }
  for (const map of mapPaths) fs.rmSync(map);
  return { removedMaps: mapPaths.size, strippedComments };
}

/** 配信物に残っている .map の一覧 */
function findLeftoverSourceMaps(assetsDir) {
  return walkFiles(assetsDir).filter((file) => file.endsWith('.map'));
}

function main(argv, { env = process.env, run = runSentryCli, log = console } = {}) {
  const { release, assets, requireMaps } = parseArgs(argv);
  const staticDir = path.join(assets, '_next', 'static');
  if (!fs.existsSync(staticDir)) {
    throw new Error(`${staticDir} がない。OpenNext のビルドの後に走らせる`);
  }
  // 数えるのは Sentry に上げる _next/static の中だけ（ほかの場所の .map は後片付けで消すが、上げる対象ではない）
  const mapCount = walkFiles(staticDir).filter((file) => file.endsWith('.map')).length;
  if (mapCount === 0 && requireMaps) {
    throw new Error('ソースマップが 1 つもない（AKYODEX_BROWSER_SOURCEMAPS=1 でビルドしたか確かめる）');
  }
  if (mapCount === 0) {
    log.warn('::warning::ソースマップが 1 つもない（AKYODEX_BROWSER_SOURCEMAPS=1 でビルドしたか確かめる）。Sentry には上げない');
  }

  const uploaded = mapCount > 0 && uploadToSentry(release, staticDir, { env, run, log });
  const { removedMaps, strippedComments } = removeSourceMaps(assets);
  const leftovers = findLeftoverSourceMaps(assets);
  if (leftovers.length > 0) {
    throw new Error(`配信物に .map が残っている: ${leftovers.slice(0, 5).join(', ')}`);
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

module.exports = {
  main,
  uploadCommands,
  uploadToSentry,
  removeSourceMaps,
  findLeftoverSourceMaps,
  parseArgs,
};
