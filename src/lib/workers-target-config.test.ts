import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

interface WorkersWranglerConfig {
  name?: string;
  main?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: Array<{
    pattern: string;
    zone_name?: string;
    custom_domain?: boolean;
  }>;
  services?: Array<{
    binding: string;
    service: string;
  }>;
  vars?: Record<string, string>;
  kv_namespaces?: Array<{
    binding: string;
    id: string;
  }>;
  d1_databases?: Array<{
    binding: string;
    database_name: string;
    database_id: string;
  }>;
  r2_buckets?: Array<{
    binding: string;
    bucket_name: string;
  }>;
}

test('Workers production config uses production data without exposing a route', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.production.jsonc');
  const routeConfigPath = path.join(
    process.cwd(),
    'wrangler.workers.production-route.jsonc'
  );
  assert.equal(existsSync(configPath), true, 'production Workers config must exist');
  assert.equal(existsSync(routeConfigPath), true, 'production route config must exist');
  if (!existsSync(configPath) || !existsSync(routeConfigPath)) return;

  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;
  const routeConfig = JSON.parse(
    await readFile(routeConfigPath, 'utf8')
  ) as WorkersWranglerConfig;
  const selfReference = config.services?.find(
    ({ binding }) => binding === 'WORKER_SELF_REFERENCE'
  );
  const dataNamespace = config.kv_namespaces?.find(({ binding }) => binding === 'AKYO_KV');
  const imageBucket = config.r2_buckets?.find(({ binding }) => binding === 'AKYO_BUCKET');
  const cacheBucket = config.r2_buckets?.find(
    ({ binding }) => binding === 'NEXT_INC_CACHE_R2_BUCKET'
  );
  const tagCache = config.d1_databases?.find(
    ({ binding }) => binding === 'NEXT_TAG_CACHE_D1'
  );

  assert.equal(config.name, 'akyodex-workers-production');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.equal(routeConfig.name, 'akyodex-workers-production');
  assert.equal(routeConfig.workers_dev, false);
  assert.deepEqual(routeConfig.routes, [{
    pattern: 'akyodex.com/*',
    zone_name: 'akyodex.com',
  }]);
  assert.equal(selfReference?.service, 'akyodex-workers-production');
  assert.equal(config.vars?.AKYODEX_DEPLOYMENT_ENVIRONMENT, 'production');
  assert.equal(config.vars?.SENTRY_ENVIRONMENT, 'production');
  assert.equal(config.vars?.GITHUB_BRANCH, 'main');
  assert.equal(dataNamespace?.id, '42b435eff5ca4de9a33d70faff6c6abc');
  assert.equal(imageBucket?.bucket_name, 'akyo-images');
  assert.equal(cacheBucket?.bucket_name, 'akyodex-workers-production-cache');
  assert.equal(tagCache?.database_name, 'akyodex-next-tag-cache-production');
  assert.notEqual(tagCache?.database_id, '1484cf52-987d-4861-9590-99d77cd40390');
});

test('Workers production workflow keeps rollback entirely on Workers', async () => {
  const workflowPath = path.join(
    process.cwd(),
    '.github',
    'workflows',
    'deploy-cloudflare-workers-production.yml'
  );
  const rollbackConfigPath = path.join(process.cwd(), 'wrangler.workers.production-rollback.jsonc');
  const routeConfigPath = path.join(
    process.cwd(),
    'wrangler.workers.production-route.jsonc'
  );

  assert.equal(existsSync(workflowPath), true, 'production Workers workflow must exist');
  assert.equal(existsSync(rollbackConfigPath), false, 'route-removal rollback config must not exist');
  assert.equal(existsSync(routeConfigPath), true, 'production route config must exist');
  if (!existsSync(workflowPath) || !existsSync(routeConfigPath)) {
    return;
  }

  const workflow = await readFile(workflowPath, 'utf8');
  const routeConfig = JSON.parse(
    await readFile(routeConfigPath, 'utf8')
  ) as WorkersWranglerConfig;
  assert.match(workflow, /github\.ref_name == 'main'/);
  assert.match(workflow, /wrangler versions upload --config wrangler\.workers\.production\.jsonc/);
  assert.match(workflow, /wrangler versions deploy --config wrangler\.workers\.production\.jsonc/);
  assert.match(workflow, /id: candidate-version/);
  assert.match(workflow, /version-id=\$\{candidate_version_id\}/);
  assert.match(
    workflow,
    /--version-id "\$\{\{ steps\.candidate-version\.outputs\.version-id \}\}"/
  );
  assert.match(workflow, /--percentage 100/);
  assert.doesNotMatch(workflow, /--version-tag "\$\{GITHUB_SHA\}@100%"/);
  assert.match(
    workflow,
    /WORKERS_ROUTE_CONFIG: wrangler\.workers\.production-route\.jsonc/
  );
  assert.match(
    workflow,
    /wrangler triggers deploy --config "\$\{WORKERS_ROUTE_CONFIG\}"/
  );
  assert.match(
    workflow,
    /npx wrangler rollback --config "\$\{WORKERS_CONFIG\}"/
  );
  assert.match(workflow, /version-id:/);
  assert.match(workflow, /inputs\['version-id'\]/);
  assert.match(workflow, /ROLLBACK_VERSION_ID/);
  assert.match(workflow, /wrangler rollback "\$\{rollback_args\[@\]\}"/);
  assert.match(workflow, /inputs\.action == 'rollback-worker'/);
  assert.doesNotMatch(workflow, /rollback-pages/);
  assert.doesNotMatch(workflow, /akyodex\.pages\.dev/);
  assert.doesNotMatch(workflow, /production-rollback\.jsonc/);
  assert.doesNotMatch(workflow, /Remove Worker route/);
  assert.match(workflow, /ADMIN_PASSWORD_OWNER/);
  assert.match(workflow, /ADMIN_PASSWORD_ADMIN/);
  assert.match(workflow, /SESSION_SECRET/);
  assert.match(workflow, /GITHUB_TOKEN/);
  assert.match(workflow, /REVALIDATE_SECRET/);
  assert.match(workflow, /SENTRY_DSN/);
  assert.match(
    workflow,
    /NEXT_PUBLIC_DIFY_CHATBOT_TOKEN: \$\{\{ vars\.NEXT_PUBLIC_DIFY_CHATBOT_TOKEN \}\}/
  );
  assert.match(workflow, /x-akyodex-worker-tag/);
  assert.match(workflow, /x-robots-tag/);
  assert.equal(
    workflow.match(/catalog\.schemaVersion!==1/g)?.length,
    3,
    'activation plus automatic and manual rollback must validate the catalog schema'
  );
  assert.match(
    workflow,
    /always\(\) && \(failure\(\) \|\| cancelled\(\)\) && steps\.deploy-version\.outcome == 'success'/
  );
  assert.deepEqual(routeConfig.routes, [{
    pattern: 'akyodex.com/*',
    zone_name: 'akyodex.com',
  }]);
});

test('Workers rollback documentation warns about Durable Object lifecycle changes', async () => {
  const operationsGuide = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'README.md'),
    'utf8'
  );

  assert.match(operationsGuide, /rollback cannot cross a Durable Object class lifecycle change/i);
});

test('Workers production workflow configures managed secrets without activating traffic', async () => {
  const workflow = await readFile(
    path.join(
      process.cwd(),
      '.github',
      'workflows',
      'deploy-cloudflare-workers-production.yml'
    ),
    'utf8'
  );

  assert.match(workflow, /- configure-secrets/);
  assert.match(workflow, /inputs\.action == 'configure-secrets'/);
  assert.match(workflow, /REVALIDATE_SECRET_VALUE: \$\{\{ secrets\.REVALIDATE_SECRET \}\}/);
  assert.match(workflow, /SENTRY_DSN_VALUE: \$\{\{ vars\.NEXT_PUBLIC_SENTRY_DSN \}\}/);
  assert.match(workflow, /randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(workflow, /wrangler versions secret bulk/);
  assert.match(workflow, /wrangler versions view/);
  assert.match(workflow, /REVALIDATE_SECRET: process\.env\.REVALIDATE_SECRET_VALUE/);
  assert.match(workflow, /SENTRY_DSN: process\.env\.SENTRY_DSN_VALUE/);
  assert.doesNotMatch(workflow, /\bnpx wrangler secret put\b/);
  assert.match(workflow, /annotations\?\.\["workers\/tag"\]===process\.env\.CANDIDATE_TAG/);
  assert.match(workflow, /Managed production Worker secrets are configured/);
});

test('CI builds and dry-runs the production Workers target on Linux', async () => {
  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8'
  );

  assert.match(workflow, /run: npm run build:workers:production/);
  assert.match(workflow, /run: npm run dry-run:workers:production/);
});

test('Workers runtime selects the Workers OpenNext cache adapters', async () => {
  const configPath = path.join(process.cwd(), 'wrangler.workers.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as WorkersWranglerConfig;

  assert.equal(config.vars?.CLOUDFLARE_DEPLOY_TARGET, 'workers');
  assert.equal(config.vars?.AKYODEX_DEPLOYMENT_ENVIRONMENT, 'staging');
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

test('Pages production rollback automation is absent', () => {
  assert.equal(
    existsSync(path.join(process.cwd(), '.github', 'workflows', 'deploy-cloudflare-pages.yml')),
    false
  );
  assert.equal(
    existsSync(path.join(process.cwd(), '.github', 'workflows', 'cloudflare-pages-preview-gate.yml')),
    false
  );
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

test('fingerprinted Next.js static assets use immutable browser caching', async () => {
  const headersPath = path.join(process.cwd(), 'public', '_headers');

  assert.equal(existsSync(headersPath), true);

  const headers = await readFile(headersPath, 'utf8');

  assert.match(headers, /^\/_next\/static\/\*$/m);
  assert.match(
    headers,
    /^\s+Cache-Control:\s*public,\s*max-age=31536000,\s*immutable$/m
  );
  assert.doesNotMatch(headers, /^\/\*$/m);
  assert.doesNotMatch(headers, /^\/api\//m);
});
