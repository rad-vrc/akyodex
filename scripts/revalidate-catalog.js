const { setTimeout: delay } = require('node:timers/promises');
const { diagnostic } = require('./catalog-sync-diagnostic');

async function revalidateCatalog({ env = process.env, request = fetch, sleep = delay, log = console } = {}) {
  const { SITE_URL, REVALIDATE_SECRET } = env;
  if (!SITE_URL || !REVALIDATE_SECRET) throw new Error('SITE_URL or REVALIDATE_SECRET is not configured');
  const payload = {
    paths: ['/', '/en', '/ko', '/zukan'],
    tags: ['akyo-data', 'akyo-data-ja', 'akyo-data-en', 'akyo-data-ko'],
    updateKV: true,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await request(`${SITE_URL}/api/revalidate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': REVALIDATE_SECRET },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      const details = result?.kvUpdateDetails;
      const completeKV = ['ja', 'en', 'ko', 'metadata'].every((key) => details?.[key] === true);
      const completePaths = payload.paths.every((path) => Array.isArray(result?.paths) && result.paths.includes(path));
      const completeTags = payload.tags.every((tag) => Array.isArray(result?.tags) && result.tags.includes(tag));
      if (response.ok && result?.success === true && result?.kvUpdated === true && completeKV && completePaths && completeTags) {
        log.log(`ISR revalidation and KV cache update succeeded (attempt ${attempt}/3)`);
        return;
      }
      const detail = diagnostic(result?.kvError || result?.error || 'Invalid or incomplete response', [REVALIDATE_SECRET]);
      log.error(`Revalidation failed (attempt ${attempt}/3, HTTP ${response.status}; KV ja=${details?.ja === true}, en=${details?.en === true}, ko=${details?.ko === true}, metadata=${details?.metadata === true}; paths=${completePaths}, tags=${completeTags}): ${detail}`);
    } catch (error) {
      const detail = diagnostic(`${error?.name || 'Error'}: ${error?.message || 'Request failed'}${error?.cause?.code ? ` (${error.cause.code})` : ''}`, [REVALIDATE_SECRET]);
      log.error(`Revalidation request failed (attempt ${attempt}/3): ${detail}`);
    }
    if (attempt < 3) await sleep(attempt * 5000);
  }
  throw new Error('ISR revalidation or KV cache update failed after 3 attempts');
}

if (require.main === module) {
  revalidateCatalog().catch((error) => {
    console.error(`::error::${diagnostic(error.message, [process.env.REVALIDATE_SECRET])}`);
    process.exitCode = 1;
  });
}

module.exports = { revalidateCatalog };
