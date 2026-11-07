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
 *   2. 配信物から .map を消す。.js・.css の最後のコメントが、行の先頭から始まる参照のコメント（このビルドの
 *      .map を指すもの）なら、その行も消す（配信する大きさを、ソースマップを作らないときに近づけるため）。
 *   3. ソースが漏れる形（.map と、インラインのソースマップのコメント）が残っていれば失敗する。
 *   コメントは構文解析器（JS は acorn、CSS は postcss）で取り出し、文字列の中のそれらしい文字は見ない。
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
const acorn = require('acorn');
const postcss = require('postcss');

const URL_PREFIX = 'app:///_next/static';
const GIT_SHA = /^[0-9a-f]{40}$/;
// コメントは正規表現で探さず、構文解析器（JS は acorn、CSS は postcss）が取り出した本物のコメントだけを見る。
// 文字列やテンプレートの中の「それらしい文字」を、消したり残りと見なしたりしないため。
// 参照のコメント（コメントの中身。`//` や `/* */` を除いたもの）。`@` は古い書き方
const REFERENCE_COMMENT = /^[#@] sourceMappingURL=([^\s'"`]+)\s*$/;
// ソースが漏れるのは .map と、インラインのソースマップ（data: に元のソースを入れられる）だけ。
// 参照のコメントが残っても、消した .map を指すだけで中身は出ない。URL のスキームは大文字小文字を区別しない
const INLINE_SOURCE_MAP_COMMENT = /^\s*[#@]\s*sourceMappingURL\s*=\s*data:/i;
const INLINE_SOURCE_MAP_ANYWHERE = /sourceMappingURL\s*=\s*data:/i;
// postcss は既定で、CSS の中のインラインのソースマップを自分で読み込もうとする（読めないと例外）。
// ここではコメントを取り出したいだけなので切る
const POSTCSS_OPTIONS = { map: { prev: false } };

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

/**
 * JS の本物のコメントを acorn で取り出す（{ type, value, start, end } の並び）。
 * スクリプトとして読めなければモジュールとして読む。どちらでも読めなければ null
 */
function scriptComments(text) {
  for (const sourceType of ['script', 'module']) {
    const comments = [];
    try {
      acorn.parse(text, { ecmaVersion: 'latest', sourceType, allowHashBang: true, onComment: comments });
      return comments;
    } catch {
      // 次の読み方を試す
    }
  }
  return null;
}

/** CSS の本物のコメントを postcss で取り出す（中身の文字列の並び）。読めなければ null */
function styleComments(text) {
  try {
    const comments = [];
    postcss.parse(text, POSTCSS_OPTIONS).walkComments((comment) => {
      comments.push(comment.text);
    });
    return comments;
  } catch {
    return null;
  }
}

/** その位置から行の先頭までが空白だけなら、行の先頭の位置を返す。そうでなければ -1 */
function lineStartIfOnlyWhitespaceBefore(text, index) {
  const lineStart = Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1;
  return text.slice(lineStart, index).trim() === '' ? lineStart : -1;
}

/** 消した後の中身を作る。参照の行の前の空行も落とし、改行 1 つで終える */
function cutFrom(text, lineStart) {
  const code = text.slice(0, lineStart).replace(/\s+$/, '');
  return code === '' ? '' : `${code}\n`;
}

/**
 * ファイルの最後のコメントが、行の先頭から始まる参照のコメントで、後ろに何もなく、指す先が mapPaths
 * （このビルドで作られた .map の絶対パス）にあれば、その行を落とした中身を返す。そうでなければ null（触らない）。
 * 同じ行にコードがあるときは触らない（行ごと消すとコードまで消える）
 */
function withoutReferenceComment(text, file, mapPaths) {
  const pointsToBuiltMap = (url) => mapPaths.has(path.resolve(path.dirname(file), url));

  if (isScriptFile(file)) {
    const last = scriptComments(text)?.at(-1);
    if (!last || last.type !== 'Line' || text.slice(last.end).trim() !== '') return null;
    const match = last.value.match(REFERENCE_COMMENT);
    const lineStart = lineStartIfOnlyWhitespaceBefore(text, last.start);
    if (!match || lineStart < 0 || !pointsToBuiltMap(match[1])) return null;
    return cutFrom(text, lineStart);
  }

  if (isStyleFile(file)) {
    // 最後の要素が本物のコメントであることを postcss で確かめてから、最後の行を消す
    let root;
    try {
      root = postcss.parse(text, POSTCSS_OPTIONS);
    } catch {
      return null;
    }
    const last = root.last;
    if (!last || last.type !== 'comment') return null;
    // postcss の comment.text は /* */ と前後の空白を除いた中身
    const match = last.text.match(/^[#@] sourceMappingURL=([^\s'"*]+)$/);
    const body = text.replace(/\s+$/, '');
    if (!match || !body.endsWith('*/')) return null;
    const commentStart = body.lastIndexOf('/*');
    const lineStart = lineStartIfOnlyWhitespaceBefore(text, commentStart);
    if (lineStart < 0 || !pointsToBuiltMap(match[1])) return null;
    return cutFrom(text, lineStart);
  }

  return null;
}

/** .js・.css の最後の参照のコメントを消してから、.map を消す */
function removeSourceMaps(assetsDir) {
  const files = walkFiles(assetsDir);
  const mapPaths = new Set(files.filter((file) => file.endsWith('.map')).map((file) => path.resolve(file)));
  let strippedComments = 0;
  for (const file of files) {
    if (!isScriptFile(file) && !isStyleFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const stripped = withoutReferenceComment(text, path.resolve(file), mapPaths);
    if (stripped === null) continue;
    fs.writeFileSync(file, stripped);
    strippedComments++;
  }
  for (const map of mapPaths) fs.rmSync(map);
  return { removedMaps: mapPaths.size, strippedComments };
}

/** インラインのソースマップを含むか。コメントを取り出せないファイルは、文字列でも見つかれば含むと見なす（漏らさない側に倒す） */
function hasInlineSourceMap(text, file) {
  const comments = isScriptFile(file)
    ? scriptComments(text)?.map((comment) => comment.value)
    : styleComments(text);
  if (comments === null || comments === undefined) return INLINE_SOURCE_MAP_ANYWHERE.test(text);
  return comments.some((comment) => INLINE_SOURCE_MAP_COMMENT.test(comment));
}

/** 配信物にソースが漏れる形（.map と、インラインのソースマップのコメント）が残っていないかを確かめる */
function findLeftoverSourceMaps(assetsDir) {
  return walkFiles(assetsDir).filter((file) => {
    if (file.endsWith('.map')) return true;
    if (!isScriptFile(file) && !isStyleFile(file)) return false;
    return hasInlineSourceMap(fs.readFileSync(file, 'utf8'), file);
  });
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
    throw new Error(`配信物にソースマップ（.map かインラインのもの）が残っている: ${leftovers.slice(0, 5).join(', ')}`);
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
