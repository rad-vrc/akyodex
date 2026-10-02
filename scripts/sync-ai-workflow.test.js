const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { parseRunOptions } = require('./sync-ai-catalog');

const root = resolve(__dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/sync-ai-catalog.yml'), 'utf8');

for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`manual dispatch defaults to read-only without a large-deletion override (${name})`, () => {
    const contents = workflow.replace(/\r?\n/g, newline);
    for (const input of ['apply', 'allow_large_deletion']) {
      const block = contents.match(new RegExp(`^      ${input}:\\s*\\r?\\n((?: {8}.*\\r?\\n)+)`, 'm'))?.[1];
      assert.ok(block);
      assert.match(block, /^        type: boolean\s*$/m);
      assert.match(block, /^        default: false\s*$/m);
    }
  });
}

test('sync is serialized, uses current main, and runs only after successful trusted sync or a manual request', () => {
  assert.match(workflow, /workflows: \['Sync JSON Data from CSV'\]/);
  assert.match(workflow, /group: ai-catalog-production\s+cancel-in-progress: false\s+queue: max/);
  assert.match(workflow, /ref: main\s+persist-credentials: false/);
  assert.match(workflow, /run: npm run data:convert/);
  assert.match(workflow, /AI_CATALOG_SYNC_ENABLED: \$\{\{ vars.AI_CATALOG_SYNC_ENABLED \}\}/);
  const condition = workflow.match(/if: >-\s+([\s\S]*?)\s+runs-on:/)[1];
  function runs(overrides = {}, enabled = 'true', ready = 'true') {
    const github = { ref: 'refs/heads/main', repository: 'owner/repo', event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'success', head_repository: { full_name: 'owner/repo' } } }, ...overrides };
    return runInNewContext(condition, { github, vars: { AI_CATALOG_SYNC_ENABLED: enabled, AI_BUDGET_READY: ready } });
  }
  assert.equal(runs(), true);
  assert.equal(runs({}, ''), false, 'automatic writes must be explicitly enabled');
  assert.equal(runs({}, 'true', ''), false, 'merging must not start a writer before budget installation');
  assert.equal(runs({ event_name: 'workflow_dispatch', event: {} }, 'true', ''), true, 'dry runs remain available before budget installation');
  assert.match(workflow, /AI_BUDGET_READY: \$\{\{ vars.AI_BUDGET_READY \}\}/);
  assert.equal(runs({ event_name: 'workflow_dispatch', event: {} }, ''), true, 'read-only rollout check stays available');
  assert.equal(runs({ ref: 'refs/heads/topic' }), false);
  assert.equal(runs({ event: { workflow_run: { conclusion: 'failure' } } }), false);
  assert.equal(runs({ event: { workflow_run: { conclusion: 'success', head_repository: { full_name: 'fork/repo' } } } }), false);
  assert.match(workflow, /APPLY: \$\{\{ github.event_name == 'workflow_run' \|\| inputs.apply \}\}/);
  assert.match(workflow, /args=\(--dry-run\)\s+if \[ "\$APPLY" = "true" \]; then\s+args=\(--apply\)/);
  assert.match(workflow, /if \[ "\$ALLOW_LARGE_DELETION" = "true" \]; then\s+args\+=\(--allow-large-deletion\)/);
  assert.match(workflow, /npm run sync:ai-catalog -- "\$\{args\[@\]\}"/);
});

test('automatic runs cannot grant a large-deletion override and deploy credentials are not reused', () => {
  const expression = workflow.match(/ALLOW_LARGE_DELETION: \$\{\{ (.+) \}\}/)[1];
  for (const event of ['workflow_run', 'workflow_dispatch']) {
    for (const override of [false, true]) {
      assert.equal(runInNewContext(expression, { github: { event_name: event }, inputs: { allow_large_deletion: override } }),
        event === 'workflow_dispatch' && override);
    }
  }
  assert.match(workflow, /AI_CATALOG_SYNC_API_TOKEN: \$\{\{ secrets.AI_CATALOG_SYNC_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  const source = readFileSync(resolve(root, 'scripts/sync-ai-catalog.js'), 'utf8');
  assert.match(source, /token: process\.env\.AI_CATALOG_SYNC_API_TOKEN/);
  assert.doesNotMatch(source, /process\.env\.CLOUDFLARE_API_TOKEN/);
});

test('CLI defaults reject implicit writes and permit large deletion only with a manual apply', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', AI_CATALOG_SYNC_ENABLED: 'true',
    AI_BUDGET_READY: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  assert.deepEqual(parseRunOptions(['--dry-run'], {}), { dryRun: true, allowLargeDeletion: false });
  assert.deepEqual(parseRunOptions(['--apply'], env), { dryRun: false, allowLargeDeletion: false });
  assert.throws(() => parseRunOptions(['--apply'], { ...env, AI_BUDGET_READY: '' }), /budget-ready/);
  assert.deepEqual(parseRunOptions(['--apply', '--allow-large-deletion'], env), { dryRun: false, allowLargeDeletion: true });
  for (const args of [[], ['--apply', '--dry-run'], ['--apply', '--apply'], ['--unknown'], ['--allow-large-deletion']]) {
    assert.throws(() => parseRunOptions(args, env), /Use --dry-run or --apply/);
  }
  assert.throws(() => parseRunOptions(['--dry-run', '--allow-large-deletion'], env), /manual workflow_dispatch --apply/);
  assert.throws(() => parseRunOptions(['--apply', '--allow-large-deletion'], { ...env, GITHUB_EVENT_NAME: 'workflow_run' }), /manual workflow_dispatch --apply/);
});

test('the CLI refuses writes without the main Actions environment and explicit enablement', () => {
  for (const env of [
    { GITHUB_ACTIONS: '', GITHUB_REF: 'refs/heads/main', AI_CATALOG_SYNC_ENABLED: 'true' },
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/topic', AI_CATALOG_SYNC_ENABLED: 'true' },
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', AI_CATALOG_SYNC_ENABLED: '' },
  ]) {
    const child = spawnSync(process.execPath, ['scripts/sync-ai-catalog.js', '--apply'], { cwd: root, encoding: 'utf8',
      env: { ...process.env, ...env, AI_CATALOG_SYNC_API_TOKEN: '', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Apply requires/);
  }
});
