const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { diagnostic } = require('./catalog-sync-diagnostic');

async function checkCatalogR2({ env = process.env, run = spawnSync, sleep = delay, log = console } = {}) {
  const { R2_BUCKET, CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = env;
  if (!R2_BUCKET || !CLOUDFLARE_ACCOUNT_ID || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('R2 bucket, account, or credentials are not configured');
  }
  const secrets = [CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN];
  const endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run('aws', ['s3', 'ls', `s3://${R2_BUCKET}/`, '--endpoint-url', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], env, timeout: 30000,
    });
    if (result.status === 0 && !result.error) {
      log.log(`R2 bucket access verified (attempt ${attempt}/3)`);
      return;
    }
    const detail = diagnostic(result.stderr || result.error?.message || 'No error details returned', secrets);
    const status = result.error?.code || result.status || 'unknown';
    log.error(`R2 bucket access failed (attempt ${attempt}/3, status ${diagnostic(status, secrets)}): ${detail}`);
    if (attempt < 3) await sleep(attempt * 5000);
  }
  throw new Error('R2 bucket access failed after 3 attempts');
}

if (require.main === module) {
  checkCatalogR2().catch((error) => {
    console.error(`::error::${diagnostic(error.message, [process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY, process.env.AWS_SESSION_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID])}`);
    process.exitCode = 1;
  });
}

module.exports = { checkCatalogR2 };
