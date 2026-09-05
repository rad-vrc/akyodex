import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCategoryListResponse, processCategoryRequest } from './category-api';
import { CATEGORY_FILE_PATHS, type CategoryStoreDeps } from './category-store';
import { GitHubConflictError } from './github-utils';

const CSV = [
  'ID,Nickname,AvatarName,Category,Comment,Author,AvatarURL',
  '0001,うまAkyo,horse,"動物,動物/うま",,tester,https://vrchat.com/home/avatar/avtr_1',
  '',
].join('\n');
const TRANSLATIONS = JSON.stringify({ '動物': { en: 'Animal', ko: '동물' }, '動物/うま': { en: 'Animal/Horse', ko: '동물/말' } });
const COLORS = JSON.stringify({ '動物': '#111111' });

function deps(commitFiles?: CategoryStoreDeps['commitFiles']) {
  const commits: unknown[] = [];
  const d: CategoryStoreDeps = {
    getBranchHead: async () => 'head-sha',
    fetchFile: async (path) => ({
      content: { [CATEGORY_FILE_PATHS.csv]: CSV, [CATEGORY_FILE_PATHS.translations]: TRANSLATIONS, [CATEGORY_FILE_PATHS.colors]: COLORS }[path] ?? '',
      sha: 'x',
    }),
    commitFiles:
      commitFiles ??
      (async (args) => {
        commits.push(args);
        return { sha: 'new-sha', commit: { html_url: 'https://github.com/x/y/commit/new-sha' } };
      }),
  };
  return { deps: d, commits };
}

async function json(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('GET builds the list with counts, translations and colours', async () => {
  const { status, body } = await json(await buildCategoryListResponse(deps().deps));
  assert.equal(status, 200);
  assert.equal(body.head, 'head-sha');
  assert.deepEqual(body.categories, [
    { path: '動物', en: 'Animal', ko: '동물', count: 1 },
    { path: '動物/うま', en: 'Animal/Horse', ko: '동물/말', count: 1 },
  ]);
  assert.deepEqual(body.colors, { '動物': '#111111' });
});

test('POST validates the envelope and gates structural actions to the owner', async () => {
  const { deps: d, commits } = deps();
  assert.equal((await processCategoryRequest(null, 'owner', d)).status, 400);
  assert.equal((await processCategoryRequest({ action: 'explode' }, 'owner', d)).status, 400);
  for (const action of ['rename', 'merge', 'delete']) {
    const { status, body } = await json(await processCategoryRequest({ action }, 'admin', d));
    assert.equal(status, 403, action);
    assert.match(String(body.error), /上位管理者/);
  }
  assert.equal(commits.length, 0);
});

test('POST create is open to admins and commits only the translation table', async () => {
  const { deps: d, commits } = deps();
  const { status, body } = await json(await processCategoryRequest({ action: 'create', path: '動物/ねこ', en: 'Cat', ko: '고양이' }, 'admin', d));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.changedRows, 0);
  assert.equal(body.head, 'new-sha');
  assert.deepEqual(body.files, [CATEGORY_FILE_PATHS.translations]);
  assert.match(String(body.message), /「動物\/ねこ」を作成/);
  assert.equal(commits.length, 1);
});

test('POST rename reports the row count and maps operation errors to their status', async () => {
  const { deps: d } = deps();
  const ok = await json(await processCategoryRequest({ action: 'rename', from: '動物', to: '生き物', en: 'Creature', ko: '생물' }, 'owner', d));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changedRows, 1);
  assert.match(String(ok.body.message), /「動物」を「生き物」に変更しました（1 件の Akyo を更新）/);

  const missing = await json(await processCategoryRequest({ action: 'delete', path: '無い' }, 'owner', d));
  assert.equal(missing.status, 404);
  const invalid = await json(await processCategoryRequest({ action: 'create', path: '動物,鳥', en: 'x', ko: 'x' }, 'owner', d));
  assert.equal(invalid.status, 400);
  assert.match(String(invalid.body.error), /「,」「、」は使えません/);
});

test('POST maps a moved branch to 409 and unexpected failures to 500', async () => {
  const conflict = deps(async () => {
    throw new GitHubConflictError('moved');
  });
  const { status, body } = await json(await processCategoryRequest({ action: 'delete', path: '動物/うま' }, 'owner', conflict.deps));
  assert.equal(status, 409);
  assert.match(String(body.error), /再読み込み/);

  const broken = deps(async () => {
    throw new Error('network down');
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await processCategoryRequest({ action: 'delete', path: '動物/うま' }, 'owner', broken.deps)).status, 500);
  } finally {
    console.error = originalError;
  }
});
