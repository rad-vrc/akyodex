import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface WorkersWranglerConfig {
  vars?: Record<string, string>;
}

test('Workers runtime selects the Workers OpenNext cache adapters', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;

  assert.equal(config.vars?.CLOUDFLARE_DEPLOY_TARGET, 'workers');
});

test('Workers staging CI deploys a tagged version and verifies that exact revision', async () => {
  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'deploy-cloudflare-workers-staging.yml'),
    'utf8'
  );

  assert.match(workflow, /wrangler deploy --config wrangler\.workers\.jsonc --tag "\$\{GITHUB_SHA\}"/);
  assert.match(workflow, /x-akyodex-worker-tag/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /tolower\(\$0\)/);
  assert.doesNotMatch(workflow, /IGNORECASE/);
  assert.doesNotMatch(workflow, /grep --ignore-case/);
});

test('Pages remains a manual rollback target during the Workers migration', async () => {
  const deployWorkflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'deploy-cloudflare-pages.yml'),
    'utf8'
  );
  const rollbackGate = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'cloudflare-pages-preview-gate.yml'),
    'utf8'
  );

  assert.doesNotMatch(deployWorkflow, /^\s{2}push:/m);
  assert.match(deployWorkflow, /github\.ref_name == 'pages-rollback'/);
  assert.match(rollbackGate, /https:\/\/akyodex\.pages\.dev/);
});
