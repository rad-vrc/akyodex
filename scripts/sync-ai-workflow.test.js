const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');

const root = resolve(__dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/sync-ai-catalog.yml'), 'utf8');

test('sync is serialized, uses current main, and runs only after successful trusted sync or a manual request', () => {
  assert.match(workflow, /workflows: \['Sync JSON Data from CSV'\]/);
  assert.match(workflow, /group: ai-catalog-production\s+cancel-in-progress: false\s+queue: max/);
  assert.match(workflow, /ref: main\s+persist-credentials: false/);
  assert.match(workflow, /run: npm run data:convert/);
  assert.match(workflow, /AI_CATALOG_SYNC_ENABLED: \$\{\{ vars.AI_CATALOG_SYNC_ENABLED \}\}/);
  const condition = workflow.match(/if: >-\s+([\s\S]*?)\s+runs-on:/)[1];
  function runs(overrides = {}, enabled = 'true') {
    const github = { ref: 'refs/heads/main', repository: 'owner/repo', event_name: 'workflow_run',
      event: { workflow_run: { conclusion: 'success', head_repository: { full_name: 'owner/repo' } } }, ...overrides };
    return runInNewContext(condition, { github, vars: { AI_CATALOG_SYNC_ENABLED: enabled } });
  }
  assert.equal(runs(), true);
  assert.equal(runs({}, ''), false, 'automatic writes must be explicitly enabled');
  assert.equal(runs({ event_name: 'workflow_dispatch', event: {} }, ''), true, 'read-only rollout check stays available');
  assert.equal(runs({ ref: 'refs/heads/topic' }), false);
  assert.equal(runs({ event: { workflow_run: { conclusion: 'failure' } } }), false);
  assert.equal(runs({ event: { workflow_run: { conclusion: 'success', head_repository: { full_name: 'fork/repo' } } } }), false);
  assert.match(workflow, /APPLY: \$\{\{ github.event_name == 'workflow_run' \|\| inputs.apply \}\}/);
  assert.match(workflow, /if \[ "\$APPLY" = "true" \]; then\s+npm run sync:ai-catalog -- --apply\s+else\s+npm run sync:ai-catalog -- --dry-run/);
});

test('the CLI refuses writes without the main Actions environment and explicit enablement', () => {
  for (const env of [
    { GITHUB_ACTIONS: '', GITHUB_REF: 'refs/heads/main', AI_CATALOG_SYNC_ENABLED: 'true' },
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/topic', AI_CATALOG_SYNC_ENABLED: 'true' },
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', AI_CATALOG_SYNC_ENABLED: '' },
  ]) {
    const child = spawnSync(process.execPath, ['scripts/sync-ai-catalog.js', '--apply'], { cwd: root, encoding: 'utf8',
      env: { ...process.env, ...env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Apply requires/);
  }
});
