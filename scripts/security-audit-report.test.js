const { test } = require('node:test');
const assert = require('node:assert/strict');
const reportSecurityAudit = require('./security-audit-report');

const clean = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };

async function run(overrides = {}, issues = []) {
  const calls = { created: [], updated: [], warnings: [], failures: [], summary: '' };
  const github = {
    paginate: async () => issues,
    rest: { issues: {
      listForRepo() {},
      create: async (value) => calls.created.push(value),
      update: async (value) => calls.updated.push(value),
    } },
  };
  const core = {
    warning: (message) => calls.warnings.push(message),
    setFailed: (message) => calls.failures.push(message),
    summary: { addRaw(value) { calls.summary = value; return this; }, async write() {} },
  };
  await reportSecurityAudit({ github, core,
    context: { repo: { owner: 'owner', repo: 'repo' }, serverUrl: 'https://github.com', runId: 123, sha: 'abc' },
    auditResults: clean, snykConfigured: true, snykOutcome: 'success',
    snykResults: { ok: true, vulnerabilities: [] }, ...overrides,
  });
  return calls;
}

test('counts npm total once and links the exact audit run', async () => {
  const result = await run({ auditResults: { metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, moderate: 1, total: 1 } } } });
  assert.match(result.created[0].title, /1 affected npm package/);
  assert.doesNotMatch(result.created[0].title, /2 affected/);
  assert.match(result.created[0].body, /actions\/runs\/123/);
});

test('updates the existing audit instead of creating a weekly duplicate', async () => {
  const result = await run({ snykConfigured: false }, [
    { number: 532, title: 'Weekly Security Audit - previous report', user: { login: 'github-actions[bot]' } },
  ]);
  assert.equal(result.created.length, 0);
  assert.equal(result.updated[0].issue_number, 532);
  assert.match(result.updated[0].body, /not configured/);
});

test('missing Snyk token is incomplete coverage, not vulnerabilities or a clean scan', async () => {
  const result = await run({ snykConfigured: false, snykOutcome: 'skipped', snykResults: null });
  assert.match(result.created[0].title, /scanner setup/);
  assert.match(result.created[0].body, /not configured/);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.failures.length, 0);
});

test('Snyk authentication errors fail the audit rather than claiming findings', async () => {
  const result = await run({ snykOutcome: 'failure', snykResults: { ok: false, error: 'Unauthorized' } });
  assert.match(result.created[0].body, /scan failed/);
  assert.doesNotMatch(result.created[0].title, /vulnerabilities found/);
  assert.equal(result.failures.length, 1);
});

test('Snyk findings are distinguished from execution errors', async () => {
  const result = await run({ snykOutcome: 'failure', snykResults: { ok: false, vulnerabilities: [{ id: 'finding' }] } });
  assert.match(result.created[0].body, /1 reported vulnerability/);
  assert.equal(result.failures.length, 0);
});

test('missing or invalid npm results cannot masquerade as a clean audit', async () => {
  for (const auditResults of [null, { error: { code: 'ENETWORK' } }, { metadata: { vulnerabilities: { total: 0 } } }]) {
    const result = await run({ auditResults });
    assert.match(result.created[0].body, /npm audit: incomplete/);
    assert.equal(result.failures.length, 1);
  }
});

test('clean scans create no issue and do not close unrelated security work', async () => {
  const result = await run();
  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 0);
  assert.equal(result.failures.length, 0);
});

test('a clean follow-up updates the tracker without automatically closing it', async () => {
  const result = await run({}, [{ number: 532, title: 'Weekly Security Audit', user: { login: 'github-actions[bot]' } }]);
  assert.match(result.updated[0].title, /no findings/);
  assert.equal(result.updated[0].state, undefined);
});

test('does not repurpose human issues or pull requests', async () => {
  const result = await run({ snykConfigured: false }, [
    { number: 1, title: 'Weekly Security Audit', user: { login: 'owner' } },
    { number: 2, title: 'Weekly Security Audit', user: { login: 'github-actions[bot]' }, pull_request: {} },
  ]);
  assert.equal(result.created.length, 1);
  assert.equal(result.updated.length, 0);
});

test('a partial multi-project Snyk scan is incomplete even when another project has findings', async () => {
  const result = await run({ snykOutcome: 'failure', snykResults: [
    { ok: false, vulnerabilities: [{ id: 'finding' }] }, { error: 'Scan failed' },
  ] });
  assert.match(result.created[0].body, /findings are unknown/);
  assert.equal(result.failures.length, 1);
});

test('multiple valid Snyk project reports retain findings', async () => {
  const result = await run({ snykOutcome: 'failure', snykResults: [
    { ok: false, vulnerabilities: [{ id: 'finding' }] }, { ok: true, vulnerabilities: [] },
  ] });
  assert.match(result.created[0].body, /1 reported vulnerability/);
  assert.equal(result.failures.length, 0);
});

test('inconsistent totals and scan outcomes do not pass as clean', async () => {
  const countResult = await run({ auditResults: { metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1 } } } });
  assert.equal(countResult.failures.length, 1);
  const outcomeResult = await run({ snykOutcome: 'failure' });
  assert.equal(outcomeResult.failures.length, 1);
});
