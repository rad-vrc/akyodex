const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');

// OpenNext AWS 4.1.1: fail closed when an upgrade changes the adapter.
const ORIGINAL_SHA256 = '6a5521bf7978d433b92827e1a472468a7187cfc334f29930e4672d21a5b79a17';
const PATCHED_SHA256 = 'be4532e8ec3ca3a3856ff0a97972668adf507d5cf4bd76862a70d9b731f188ca';
const sha256 = (source) => createHash('sha256').update(source).digest('hex');

function patchSource(source) {
  const hash = sha256(source);
  if (hash === PATCHED_SHA256) return source;
  if (hash !== ORIGINAL_SHA256) {
    throw new Error('Review the upstream OpenNext Cloudflare adapter before updating the response cancellation fix.');
  }
  const changes = [
    [
      '    const streamCreator = {',
      '    const bodyCancellation = new AbortController();\n    const streamCreator = {',
    ],
    [
      '                start(c) {\n                    controller = c;\n                },',
      '                start(c) {\n                    controller = c;\n                },\n                cancel() {\n                    bodyCancellation.abort();\n                },',
    ],
    [
      '        abortSignal: abortSignal,',
      '        abortSignal: AbortSignal.any([...(abortSignal ? [abortSignal] : []), bodyCancellation.signal]),',
    ],
  ];
  for (const [before, after] of changes) source = source.replace(before, after);
  if (sha256(source) !== PATCHED_SHA256) throw new Error('OpenNext cancellation patch did not produce the expected adapter.');
  return source;
}

function patchFile(file) {
  const source = readFileSync(file, 'utf8');
  const patched = patchSource(source);
  if (patched === source) return false;
  writeFileSync(file, patched);
  return true;
}

if (require.main === module) {
  try {
    // Patch Cloudflare's dependency even when npm does not hoist it to the root.
    const requireFromOpenNext = createRequire(require.resolve('@opennextjs/cloudflare'));
    const file = requireFromOpenNext.resolve('@opennextjs/aws/overrides/wrappers/cloudflare-node.js');
    const changed = patchFile(file);
    console.log(`[fix-opennext-response-cancellation] ${changed ? 'applied' : 'already applied'}`);
  } catch (error) {
    console.error('[fix-opennext-response-cancellation]', error.message);
    process.exitCode = 1;
  }
}

module.exports = { patchSource, patchFile };
