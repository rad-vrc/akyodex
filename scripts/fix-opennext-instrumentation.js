/**
 * Workaround for OpenNext + Next.js 16 standalone output mismatch.
 *
 * Next.js can generate `.next/server/instrumentation.js` while omitting
 * `.next/standalone/.next/server/instrumentation.js`.
 *
 * OpenNext expects the standalone file and its locally traced chunks to exist
 * when `.next/server/instrumentation.js.nft.json` is present. Next.js 16 can
 * omit both from the standalone tree, which either fails the build or leaves a
 * runtime instrumentation import pointing at a missing chunk.
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, '.next', 'server');
const targetDir = path.join(projectRoot, '.next', 'standalone', '.next', 'server');
const manifestPath = path.join(sourceDir, 'instrumentation.js.nft.json');

const filesToMirror = ['instrumentation.js', 'instrumentation.js.map'];

function mirrorIfMissing(sourcePath, targetPath, label) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  if (fs.existsSync(targetPath)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[fix-opennext-instrumentation] copied: ${label}`);
  } catch (error) {
    console.error(
      `[fix-opennext-instrumentation] failed to copy ${label}: ${sourcePath} -> ${targetPath}`
    );
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  }
}

for (const fileName of filesToMirror) {
  mirrorIfMissing(path.join(sourceDir, fileName), path.join(targetDir, fileName), fileName);
}

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const tracedFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const sourcePrefix = `${path.resolve(sourceDir)}${path.sep}`;

  for (const tracedFile of tracedFiles) {
    if (typeof tracedFile !== 'string') {
      continue;
    }

    const sourcePath = path.resolve(sourceDir, tracedFile);
    if (!sourcePath.startsWith(sourcePrefix) || !fs.existsSync(sourcePath)) {
      continue;
    }

    const relativePath = path.relative(sourceDir, sourcePath);
    mirrorIfMissing(sourcePath, path.join(targetDir, relativePath), relativePath);
  }
}
