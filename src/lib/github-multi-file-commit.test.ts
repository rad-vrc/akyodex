import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubConflictError, commitFilesToGitHub, getBranchHead, type GitHubConfig } from './github-utils';

const config: GitHubConfig = { token: 't', owner: 'rad-vrc', repo: 'akyodex', branch: 'main' };

function fakeFetch(handlers: Record<string, (init: RequestInit) => { status?: number; body: unknown }>) {
  const calls: { method: string; endpoint: string; body: unknown }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const endpoint = url.replace('https://api.github.com/repos/rad-vrc/akyodex/', '');
    const method = init?.method ?? 'GET';
    const key = `${method} ${endpoint}`;
    calls.push({ method, endpoint, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    const { status = 200, body } = handler(init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

test('getBranchHead reads the ref of the configured branch', async () => {
  const { fetchFn, calls } = fakeFetch({ 'GET git/ref/heads/main': () => ({ body: { object: { sha: 'abc' } } }) });
  assert.equal(await getBranchHead(config, fetchFn), 'abc');
  assert.equal(calls.length, 1);
});

test('commitFilesToGitHub builds blobs, tree and commit on the parent and moves the ref without force', async () => {
  let blobs = 0;
  const { fetchFn, calls } = fakeFetch({
    'GET git/commits/parent': () => ({ body: { tree: { sha: 'tree-parent' } } }),
    'POST git/blobs': () => ({ body: { sha: `blob-${(blobs += 1)}` } }),
    'POST git/trees': () => ({ body: { sha: 'tree-new' } }),
    'POST git/commits': () => ({ body: { sha: 'commit-new', html_url: 'https://github.com/rad-vrc/akyodex/commit/commit-new' } }),
    'PATCH git/refs/heads/main': () => ({ body: { object: { sha: 'commit-new' } } }),
  });
  const result = await commitFilesToGitHub({
    files: [
      { path: 'data/akyo-data-ja.csv', content: 'ID\n0001\n' },
      { path: 'data/category-translations.json', content: '{}\n' },
    ],
    message: 'Rename category',
    parentSha: 'parent',
    config,
    fetchFn,
  });
  assert.equal(result.sha, 'commit-new');
  assert.equal(result.commit.html_url, 'https://github.com/rad-vrc/akyodex/commit/commit-new');
  assert.deepEqual(calls.map((call) => `${call.method} ${call.endpoint}`), [
    'GET git/commits/parent',
    'POST git/blobs',
    'POST git/blobs',
    'POST git/trees',
    'POST git/commits',
    'PATCH git/refs/heads/main',
  ]);
  assert.deepEqual(calls[1].body, { content: 'ID\n0001\n', encoding: 'utf-8' });
  assert.deepEqual(calls[3].body, {
    base_tree: 'tree-parent',
    tree: [
      { path: 'data/akyo-data-ja.csv', mode: '100644', type: 'blob', sha: 'blob-1' },
      { path: 'data/category-translations.json', mode: '100644', type: 'blob', sha: 'blob-2' },
    ],
  });
  assert.deepEqual(calls[4].body, { message: 'Rename category', tree: 'tree-new', parents: ['parent'] });
  assert.deepEqual(calls[5].body, { sha: 'commit-new', force: false });
});

test('commitFilesToGitHub turns a non-fast-forward ref update into GitHubConflictError', async () => {
  const { fetchFn } = fakeFetch({
    'GET git/commits/parent': () => ({ body: { tree: { sha: 'tree-parent' } } }),
    'POST git/blobs': () => ({ body: { sha: 'blob' } }),
    'POST git/trees': () => ({ body: { sha: 'tree-new' } }),
    'POST git/commits': () => ({ body: { sha: 'commit-new', html_url: 'u' } }),
    'PATCH git/refs/heads/main': () => ({ status: 422, body: { message: 'Update is not a fast forward' } }),
  });
  await assert.rejects(
    () => commitFilesToGitHub({ files: [{ path: 'a', content: 'b' }], message: 'm', parentSha: 'parent', config, fetchFn }),
    (error: unknown) => error instanceof GitHubConflictError && /not a fast forward/.test(error.message),
  );
  await assert.rejects(
    () => commitFilesToGitHub({ files: [], message: 'm', parentSha: 'parent', config, fetchFn }),
    /No files to commit/,
  );
});
