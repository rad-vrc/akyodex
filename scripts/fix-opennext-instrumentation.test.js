const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('mirrors local files traced by the instrumentation NFT manifest', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'opennext-instrumentation-'));
  const serverDir = path.join(fixtureRoot, '.next', 'server');
  const chunkRelativePath = path.join('chunks', 'instrumentation-runtime.js');

  try {
    await mkdir(path.join(serverDir, 'chunks'), { recursive: true });
    await writeFile(path.join(serverDir, 'instrumentation.js'), 'module.exports = {}');
    await writeFile(path.join(serverDir, chunkRelativePath), 'module.exports = "traced"');
    await writeFile(
      path.join(serverDir, 'instrumentation.js.nft.json'),
      JSON.stringify({ version: 1, files: [`./${chunkRelativePath.replaceAll('\\', '/')}`] })
    );

    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), 'scripts', 'fix-opennext-instrumentation.js')],
      { cwd: fixtureRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const mirroredChunk = path.join(
      fixtureRoot,
      '.next',
      'standalone',
      '.next',
      'server',
      chunkRelativePath
    );
    assert.equal(await readFile(mirroredChunk, 'utf8'), 'module.exports = "traced"');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
