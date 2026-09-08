const { readFileSync } = require('node:fs');

function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = async function reportSecurityAudit({
  github, context, core,
  auditResults = readReport('audit-results.json'),
  snykResults = readReport('snyk.json'),
  snykConfigured = process.env.SNYK_CONFIGURED === 'true',
  snykOutcome = process.env.SNYK_OUTCOME,
}) {
  const counts = auditResults?.metadata?.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  const npmComplete = !auditResults?.error && counts &&
    [...severities, 'total'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0) &&
    severities.reduce((sum, key) => sum + counts[key], 0) === counts.total;
  const failures = [];
  if (!npmComplete) failures.push('npm audit: incomplete or invalid report; inspect the run logs.');

  let snykStatus;
  let snykCount = 0;
  if (!snykConfigured) {
    snykStatus = 'not configured: SNYK_TOKEN is missing; Snyk coverage is unavailable.';
    core.warning(snykStatus);
  } else {
    const reports = Array.isArray(snykResults) ? snykResults : [snykResults];
    const valid = reports.length > 0 && reports.every((report) => report && !report.error &&
      typeof report.ok === 'boolean' && Array.isArray(report.vulnerabilities) &&
      report.ok === (report.vulnerabilities.length === 0));
    if (valid) snykCount = reports.reduce((sum, report) => sum + report.vulnerabilities.length, 0);
    const expectedOutcome = snykCount > 0 ? 'failure' : 'success';
    if (!valid || snykOutcome !== expectedOutcome) {
      snykCount = 0;
      snykStatus = 'scan failed or returned an invalid report; findings are unknown (see run logs).';
      failures.push(`Snyk: ${snykStatus}`);
    } else {
      snykStatus = snykCount > 0 ? `${snykCount} reported vulnerability entries (high/critical scan).` : 'no high/critical findings.';
    }
  }

  const npmCount = npmComplete ? counts.total : 0;
  const needsAttention = npmCount > 0 || snykCount > 0 || !snykConfigured || failures.length > 0;
  const title = `Weekly Security Audit - ${npmCount > 0 ? `${npmCount} affected npm package(s); ` : ''}${
    failures.length > 0 ? 'scanner failure' : !snykConfigured ? 'scanner setup required' :
      snykCount > 0 ? 'Snyk findings' : npmCount > 0 ? 'dependency updates required' : 'no findings in latest scans'
  }`;
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const body = [
    '## Security Audit Results', '',
    `**Date**: ${new Date().toISOString()}`,
    `**Ref**: ${context.ref}`, `**Commit**: ${context.sha}`, `**Run and artifacts**: ${runUrl}`, '',
    '**npm audit**:',
    ...(npmComplete ? [...severities, 'total'].map((key) => `- ${key}: ${counts[key]}`) : [failures[0]]),
    '', '`total` counts affected packages, not distinct advisories; it is not added to severity counts.',
    '', `**Snyk**: ${snykStatus}`, '',
    'This issue tracks the latest dependency scans. CodeQL findings remain in GitHub code scanning.',
    'Previous weekly reports remain in closed issues. A clean scan does not automatically close this tracker.',
  ].join('\n');
  await core.summary.addRaw(body).write();
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...context.repo, state: 'open', labels: 'security,automated', per_page: 100,
  });
  const existing = issues.filter((issue) => !issue.pull_request &&
    issue.user?.login === 'github-actions[bot]' && issue.title.includes('Weekly Security Audit'))
    .sort((a, b) => b.number - a.number)[0];
  if (existing) {
    await github.rest.issues.update({ ...context.repo, issue_number: existing.number, title, body });
  } else if (needsAttention) {
    await github.rest.issues.create({ ...context.repo, title, body, labels: ['security', 'automated'] });
  }
  if (failures.length > 0) core.setFailed(failures.join('\n'));
};
