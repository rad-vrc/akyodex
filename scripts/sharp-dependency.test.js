const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

function assertPatched(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 0 || (major === 0 && (minor > 35 || (minor === 35 && patch >= 5))),
    `sharp ${version} predates the librsvg security fix (0.35.5)`);
}

test('every locked sharp copy includes the librsvg security fix', () => {
  const lock = JSON.parse(readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  const copies = Object.entries(lock.packages).filter(([name]) => name.endsWith('/sharp'));
  assert.ok(copies.length > 0);
  for (const [, pkg] of copies) assertPatched(pkg.version);
});

test('root and Miniflare sharp can decode SVG and encode card image formats', async () => {
  const fromWrangler = createRequire(require.resolve('wrangler/package.json'));
  const fromMiniflare = createRequire(fromWrangler.resolve('miniflare'));
  for (const sharp of [require('sharp'), fromMiniflare('sharp')]) {
    assertPatched(sharp.versions.sharp);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');
    for (const format of ['webp', 'avif']) {
      const output = await sharp(svg).resize(4, 4).toFormat(format).toBuffer();
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.width, 4);
      assert.equal(metadata.height, 4);
      assert.ok(output.length > 0);
    }
  }
});
