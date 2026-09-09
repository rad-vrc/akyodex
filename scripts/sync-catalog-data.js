const { execFileSync, spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

const generatedPaths = [
  'data/akyo-data-ja.json', 'data/akyo-data-en.json', 'data/akyo-data-ko.json',
  'data/akyo-data-en.csv', 'data/akyo-data-ko.csv',
  'src/fonts/mplus2-variable.subset.woff2', 'src/fonts/subset-manifest.json',
  'src/lib/category-canonical.json',
];
const fontPath = 'src/fonts/mplus2-variable.subset.woff2';

// Only for a disposable Actions checkout. Never rebase generated artifacts.
async function syncCatalogData({ cwd, generate, maxAttempts = 3, retryDelayMs = 5000 }) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('status', '--porcelain')) throw new Error('Catalog sync requires a clean checkout');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    git('fetch', '--no-tags', 'origin', 'refs/heads/main');
    // Rejected commits remain in the reflog; no force push or workspace reset.
    git('switch', '--detach', 'FETCH_HEAD');
    const base = git('rev-parse', 'HEAD');
    console.log(`Catalog generation attempt ${attempt}/${maxAttempts}, base ${base}`);
    await generate(cwd);
    git('add', '--', ...generatedPaths);
    const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
    if (staged.some((path) => !generatedPaths.includes(path)) || git('diff', '--name-only') || git('ls-files', '--others', '--exclude-standard')) {
      throw new Error('Generation changed files outside the catalog output allowlist');
    }
    const changed = git('diff', '--cached', '--name-only') !== '';
    const fontChanged = git('diff', '--cached', '--name-only', '--', fontPath) !== '';
    if (!changed) {
      // A remote update during generation also needs a retry on the no-op path.
      git('fetch', '--no-tags', 'origin', 'refs/heads/main');
      if (git('rev-parse', 'FETCH_HEAD') === base) {
        return { changed: false, pushed: false, fontChanged: false, sha: base };
      }
    } else {
      git('commit', '-m', 'chore: auto-sync JSON data from CSV changes');
      const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd, encoding: 'utf8' });
      if (push.error) throw push.error;
      if (push.status === 0) {
        return { changed: true, pushed: true, fontChanged, sha: git('rev-parse', 'HEAD') };
      }
      process.stderr.write(push.stderr || 'git push failed\n');
    }
    if (attempt < maxAttempts) await delay(retryDelayMs * 2 ** (attempt - 1));
  }
  throw new Error(`Catalog sync failed after ${maxAttempts} attempts; no artifacts may be published`);
}

if (require.main === module) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Run this entrypoint only in the main-branch Actions checkout');
  }
  execFileSync('git', ['config', '--local', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
  execFileSync('git', ['config', '--local', 'user.name', 'github-actions[bot]']);
  syncCatalogData({
    cwd: process.cwd(),
    generate(cwd) {
      execFileSync('bash', ['scripts/regenerate-catalog-data.sh'], { cwd, stdio: 'inherit' });
    },
  }).then((result) => {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(`Catalog sync complete: ${result.sha}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { syncCatalogData };
