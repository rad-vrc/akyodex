/**
 * Strip authored comments from static JavaScript assets before deployment.
 *
 * Files under `public/` are copied to the CDN verbatim, so their source
 * comments are readable by anyone who opens the URL. `sw.js` is currently the
 * only such file, but any future one would leak the same way.
 *
 * Assets under `_next/` are skipped: the bundler already emits them minified.
 *
 * The rewrite only reprints the parsed AST — no compression, no identifier
 * mangling — so names stay traceable in DevTools and, unlike a bundler pass, the
 * output does not gain an implicit `"use strict"`. Every file is then re-parsed
 * and checked against its source, because a broken Service Worker persists in
 * visitors' browsers.
 *
 * Printing is compact rather than beautified so that feeding an already-minified
 * asset through here cannot inflate it; a file that still grows fails the build
 * instead of shipping.
 */

const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');

const SKIPPED_DIRECTORIES = new Set(['_next']);
const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/** Collect deployable scripts, skipping already-minified bundler output. */
function collectAssetScripts(assetsDir) {
  const found = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(entryPath);
      } else if (
        entry.isFile() &&
        SCRIPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ) {
        found.push(entryPath);
      }
    }
  };

  walk(assetsDir);
  return found.sort();
}

/** Reprint `source` without comments, preserving identifiers and semantics. */
async function stripComments(source) {
  const { code } = await minify(source, {
    compress: false,
    mangle: false,
    format: { comments: false, beautify: false },
  });

  if (typeof code !== 'string') {
    throw new Error('terser returned no output');
  }

  return code;
}

/**
 * Re-parse both inputs and print them through a second, differently-configured
 * terser pass; a mismatch means the reprint dropped more than comments.
 *
 * This is a guard, not a proof of semantic identity. Mangling normalizes local
 * names, so a difference confined to those would not surface. Compression stays
 * off here on purpose: with it on, terser also discards `debugger` statements
 * and unreachable code, which would hide exactly the kind of drift worth
 * catching.
 */
async function assertReparsesIdentically(before, after) {
  const canonicalize = async (source) => {
    const { code } = await minify(source, { compress: false, mangle: true });
    if (typeof code !== 'string') {
      throw new Error('terser returned no output while canonicalizing');
    }
    return code;
  };

  if ((await canonicalize(before)) !== (await canonicalize(after))) {
    throw new Error('comment removal changed more than comments');
  }
}

async function main() {
  const assetsDir = path.join(process.cwd(), '.open-next', 'assets');

  if (!fs.existsSync(assetsDir)) {
    console.error(`❌ ${assetsDir} was not found! Run the OpenNext build first.`);
    process.exit(1);
  }

  const scripts = collectAssetScripts(assetsDir);
  console.log(`🧹 Stripping comments from ${scripts.length} static script(s)...`);

  for (const scriptPath of scripts) {
    const name = path.relative(assetsDir, scriptPath);
    const original = fs.readFileSync(scriptPath, 'utf8');
    const stripped = await stripComments(original);
    await assertReparsesIdentically(original, stripped);

    const saved = Buffer.byteLength(original) - Buffer.byteLength(stripped);
    if (saved < 0) {
      throw new Error(`${name} grew by ${-saved} bytes; refusing to ship it`);
    }

    fs.writeFileSync(scriptPath, stripped);
    console.log(`✅ ${name} (${saved} bytes smaller)`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}

module.exports = { collectAssetScripts, stripComments, assertReparsesIdentically };
