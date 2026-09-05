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
 * mangling — so the output stays readable and, unlike a bundler pass, does not
 * gain an implicit `"use strict"`. Equivalence is asserted per file rather than
 * assumed, because a broken Service Worker persists in visitors' browsers.
 */

const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');

const SKIPPED_DIRECTORIES = new Set(['_next']);

/** Collect deployable `.js` assets, skipping already-minified bundler output. */
function collectAssetScripts(assetsDir) {
  const found = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
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
    format: { comments: false, beautify: true, indent_level: 2 },
  });

  if (typeof code !== 'string') {
    throw new Error('terser returned no output');
  }

  return code;
}

/**
 * Fully minify both inputs and compare. Identical output means the two parse to
 * the same program, so the only thing the rewrite dropped was comments.
 */
async function assertSameProgram(before, after) {
  const canonicalize = async (source) => {
    const { code } = await minify(source, { compress: true, mangle: true });
    if (typeof code !== 'string') {
      throw new Error('terser returned no output while canonicalizing');
    }
    return code;
  };

  if ((await canonicalize(before)) !== (await canonicalize(after))) {
    throw new Error('comment removal changed the program');
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
    const original = fs.readFileSync(scriptPath, 'utf8');
    const stripped = await stripComments(original);
    await assertSameProgram(original, stripped);
    fs.writeFileSync(scriptPath, stripped);

    const name = path.relative(assetsDir, scriptPath);
    const saved = original.length - stripped.length;
    console.log(`✅ ${name} (-${saved} bytes)`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}

module.exports = { collectAssetScripts, stripComments, assertSameProgram };
