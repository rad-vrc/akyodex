const { readFileSync } = require('node:fs');

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDeploymentMetadata(deployment) {
  if (!deployment || typeof deployment !== 'object') return undefined;

  const trigger = deployment.deployment_trigger;
  const triggerMetadata =
    trigger && typeof trigger === 'object' && trigger.metadata && typeof trigger.metadata === 'object'
      ? trigger.metadata
      : {};

  return {
    id: readString(deployment.Id ?? deployment.id),
    environment: readString(deployment.Environment ?? deployment.environment),
    branch: readString(
      deployment.Branch ?? triggerMetadata.branch ?? triggerMetadata.commit_ref
    ),
    source: readString(
      deployment.Source ??
        triggerMetadata.commit_hash ??
        triggerMetadata.commit_sha ??
        triggerMetadata.sha
    ),
    url: readString(deployment.Deployment ?? deployment.url),
    dashboardUrl: readString(deployment.Build),
  };
}

function commitMatches(expectedSha, source) {
  const normalizedExpected = expectedSha.trim().toLowerCase();
  const normalizedSource = source.trim().toLowerCase();

  if (!/^[0-9a-f]{7,40}$/.test(normalizedExpected)) return false;
  if (!/^[0-9a-f]{7,40}$/.test(normalizedSource)) return false;

  return (
    normalizedExpected.startsWith(normalizedSource) ||
    normalizedSource.startsWith(normalizedExpected)
  );
}

function validatePagesDeploymentUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.pages.dev')) {
    throw new Error(`Pages deployment URL must use HTTPS on pages.dev: ${rawUrl}`);
  }
  return url.toString().replace(/\/$/, '');
}

function findPagesPreviewDeployment(deployments, expectedSha, expectedBranch) {
  if (!Array.isArray(deployments)) {
    throw new TypeError('Pages deployments payload must be an array');
  }

  const match = deployments
    .map(getDeploymentMetadata)
    .filter(Boolean)
    .find(
      (deployment) =>
        deployment.environment.toLowerCase() === 'preview' &&
        deployment.branch === expectedBranch &&
        commitMatches(expectedSha, deployment.source) &&
        deployment.url.length > 0
    );

  if (!match) return undefined;

  return {
    id: match.id,
    url: validatePagesDeploymentUrl(match.url),
    dashboardUrl: match.dashboardUrl,
    source: match.source,
  };
}

function writeGitHubOutputs(deployment) {
  const outputs = [
    ['deployment_id', deployment.id],
    ['deployment_url', deployment.url],
    ['deployment_dashboard_url', deployment.dashboardUrl],
    ['deployment_source', deployment.source],
  ];

  for (const [key, value] of outputs) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

if (require.main === module) {
  const [jsonPath, expectedSha, expectedBranch] = process.argv.slice(2);
  if (!jsonPath || !expectedSha || !expectedBranch) {
    console.error(
      'Usage: node scripts/find-pages-preview-deployment.js <deployments.json> <sha> <branch>'
    );
    process.exit(64);
  }

  const deployments = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const deployment = findPagesPreviewDeployment(
    deployments,
    expectedSha,
    expectedBranch
  );

  if (!deployment) {
    console.error(
      `No Pages preview deployment matched branch ${expectedBranch} and commit ${expectedSha}`
    );
    process.exit(2);
  }

  writeGitHubOutputs(deployment);
}

module.exports = {
  findPagesPreviewDeployment,
};
