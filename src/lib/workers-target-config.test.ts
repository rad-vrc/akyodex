import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface WorkersWranglerConfig {
  vars?: Record<string, string>;
  r2_buckets?: Array<{
    binding: string;
    bucket_name: string;
  }>;
}

test('Workers runtime selects the Workers OpenNext cache adapters', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;

  assert.equal(config.vars?.CLOUDFLARE_DEPLOY_TARGET, 'workers');
});

test('Workers staging keeps admin image mutations out of the production R2 bucket', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;
  const imageBucket = config.r2_buckets?.find(({ binding }) => binding === 'AKYO_BUCKET');

  assert.equal(imageBucket?.bucket_name, 'akyodex-workers-staging-data');
  assert.notEqual(imageBucket?.bucket_name, 'akyo-images');
});

test('Workers staging CI deploys a tagged version and verifies that exact revision', async () => {
  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'deploy-cloudflare-workers-staging.yml'),
    'utf8'
  );

  assert.match(workflow, /wrangler deploy --config wrangler\.workers\.jsonc --tag "\$\{GITHUB_SHA\}"/);
  assert.match(workflow, /x-akyodex-worker-tag/);
  assert.match(workflow, /x-robots-tag/);
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
  assert.match(
    deployWorkflow,
    /--branch=\$\{\{ env\.CF_PAGES_PRODUCTION_BRANCH \}\}/
  );
  assert.match(rollbackGate, /https:\/\/akyodex\.pages\.dev/);
});

test('Pages PR previews are deployed independently without unfreezing Pages production', async () => {
  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'deploy-cloudflare-pages-preview.yml'),
    'utf8'
  );
  const pagesConfig = await readFile(path.join(process.cwd(), 'wrangler.toml'), 'utf8');
  const prepareScript = await readFile(
    path.join(process.cwd(), 'scripts', 'prepare-cloudflare-pages.js'),
    'utf8'
  );

  assert.match(workflow, /cloudflare-pages-preview-\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.match(workflow, /npm run build/);
  assert.match(
    workflow,
    /CLOUDFLARE_PAGES_PREVIEW_PROJECT \|\| 'akyodex-pr-preview'/
  );
  assert.doesNotMatch(
    workflow,
    /CF_PAGES_PROJECT: \$\{\{ vars\.CLOUDFLARE_PAGES_PROJECT \|\| 'akyodex' \}\}/
  );
  assert.match(workflow, /test -f \.open-next\/_worker\.js/);
  assert.match(workflow, /wrangler pages deploy \.open-next/);
  assert.match(workflow, /--branch="pr-\$\{PR_NUMBER\}"/);
  assert.match(workflow, /--commit-hash="\$\{PR_HEAD_SHA\}"/);
  assert.match(workflow, /pages deployment list/);
  assert.match(workflow, /find-pages-preview-deployment\.js/);
  assert.match(workflow, /actions\/github-script@v9/);
  assert.match(workflow, /github\.paginate\(github\.rest\.issues\.listComments/);
  assert.match(workflow, /Pages Preview is mechanically read-only/);
  assert.match(workflow, /staging\.akyodex\.com/);
  assert.match(workflow, /x-robots-tag/);
  assert.match(workflow, /\/api\/admin\/login/);
  assert.match(workflow, /expected HTTP 403/);
  assert.match(pagesConfig, /\[env\.preview\]/);
  assert.match(pagesConfig, /PAGES_PREVIEW_READ_ONLY\s*=\s*"true"/);
  assert.match(pagesConfig, /id\s*=\s*"4bb2a26d80ba4389b8f470c1a4926788"/);
  assert.match(pagesConfig, /bucket_name\s*=\s*"akyodex-pages-preview-data"/);
  assert.match(pagesConfig, /bucket_name\s*=\s*"akyodex-pages-preview-cache"/);
  assert.match(prepareScript, /cloudflare-pages-worker-entry\.mjs/);
});
