const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findPagesPreviewDeployment,
} = require('./find-pages-preview-deployment');

const deployments = [
  {
    Id: '859239ef-bb60-4573-ad3c-d5105c68e13c',
    Environment: 'Preview',
    Branch: 'pr-441',
    Source: 'aa9050f',
    Deployment: 'https://859239ef.akyodex.pages.dev',
    Status: 'Idle',
    Build:
      'https://dash.cloudflare.com/example/pages/view/akyodex/859239ef-bb60-4573-ad3c-d5105c68e13c',
  },
];

test('finds the immutable Pages URL by branch and commit metadata', () => {
  assert.deepEqual(
    findPagesPreviewDeployment(
      deployments,
      'aa9050fd1234567890abcdef1234567890abcdef',
      'pr-441'
    ),
    {
      id: '859239ef-bb60-4573-ad3c-d5105c68e13c',
      url: 'https://859239ef.akyodex.pages.dev',
      dashboardUrl:
        'https://dash.cloudflare.com/example/pages/view/akyodex/859239ef-bb60-4573-ad3c-d5105c68e13c',
      source: 'aa9050f',
    }
  );
});

test('does not accept a deployment from another branch or commit', () => {
  assert.equal(
    findPagesPreviewDeployment(
      deployments,
      'bb9050fd1234567890abcdef1234567890abcdef',
      'pr-441'
    ),
    undefined
  );
  assert.equal(
    findPagesPreviewDeployment(
      deployments,
      'aa9050fd1234567890abcdef1234567890abcdef',
      'pr-442'
    ),
    undefined
  );
});

test('ignores matching deployment metadata until its immutable URL is available', () => {
  assert.equal(
    findPagesPreviewDeployment(
      [
        {
          ...deployments[0],
          Deployment: '',
        },
      ],
      'aa9050fd1234567890abcdef1234567890abcdef',
      'pr-441'
    ),
    undefined
  );
});

test('rejects deployment URLs outside pages.dev', () => {
  assert.throws(
    () =>
      findPagesPreviewDeployment(
        [
          {
            ...deployments[0],
            Deployment: 'https://example.invalid',
          },
        ],
        'aa9050fd1234567890abcdef1234567890abcdef',
        'pr-441'
      ),
    /pages\.dev/
  );
});

test('rejects malformed deployment URLs with a descriptive error', () => {
  assert.throws(
    () =>
      findPagesPreviewDeployment(
        [
          {
            ...deployments[0],
            Deployment: 'not-a-url',
          },
        ],
        'aa9050fd1234567890abcdef1234567890abcdef',
        'pr-441'
      ),
    /Invalid Pages deployment URL: not-a-url/
  );
});
