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
  assert.deepEqual(body.createdPaths, ['動物/ねこ']);
  assert.equal(commits.length, 1);
});

test('POST create reports every path it registered, parents included', async () => {
  // 画面はこの一覧で自分の候補を追従させる。返さないと、作ったばかりの親の下に
  // もう 1 つ作るときに「まだ存在しない親」を送ってしまう
  const { deps: d } = deps();
  const { status, body } = await json(
    await processCategoryRequest(
      {
        action: 'create',
        path: '植物/木',
        en: 'Tree',
        ko: '나무',
        ancestors: [{ path: '植物', en: 'Plant', ko: '식물' }],
      },
      'admin',
      d,
    ),
  );

  assert.equal(status, 200);
  assert.deepEqual(body.createdPaths, ['植物', '植物/木']);
  assert.match(String(body.message), /「植物\/木」を作成しました（親階層「植物」も作成）/);
});

test('POST create accepts a category with no translation at all', async () => {
  // 対訳は任意。日本語だけで登録でき、訳が入るまでは日本語のまま表示される
  const { deps: d, commits } = deps();
  const { status, body } = await json(
    await processCategoryRequest({ action: 'create', path: '動物/ねこ' }, 'admin', d),
  );

  assert.equal(status, 200);
  assert.deepEqual(body.createdPaths, ['動物/ねこ']);
  const written = JSON.parse(
    (commits[0] as { files: { path: string; content: string }[] }).files.find(
      (file) => file.path === CATEGORY_FILE_PATHS.translations,
    )!.content,
  );
  assert.deepEqual(written['動物/ねこ'], { en: null, ko: null }, 'キーは作る（未登録扱いにしない）');
});

test('POST checks the head the list was read from before applying a change', async () => {
  const { deps: d, commits } = deps();
  const missing = await json(await processCategoryRequest({ action: 'delete', path: '動物/うま' }, 'owner', d));
  assert.equal(missing.status, 400);
  assert.match(String(missing.body.error), /head/);
  const stale = await json(await processCategoryRequest({ action: 'delete', path: '動物/うま', head: 'old-sha' }, 'owner', d));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.head, 'head-sha');
  assert.match(String(stale.body.error), /再読み込み/);
  assert.equal(commits.length, 0);
  const fresh = await json(await processCategoryRequest({ action: 'delete', path: '動物/うま', head: 'head-sha' }, 'owner', d));
  assert.equal(fresh.status, 200);
  // create may omit head (the picker modal has no list); a wrong head is still refused.
  assert.equal((await processCategoryRequest({ action: 'create', path: '動物/ねこ', en: 'Cat', ko: '고양이' }, 'admin', d)).status, 200);
  assert.equal((await processCategoryRequest({ action: 'create', path: '動物/いぬ', en: 'Dog', ko: '개', head: 'old-sha' }, 'admin', d)).status, 409);
});

test('POST translate is open to admins while rename of the same category is not', async () => {
  const { deps: d } = deps();
  const translate = await json(await processCategoryRequest({ action: 'translate', path: '動物', en: 'Beast', ko: '짐승', head: 'head-sha' }, 'admin', d));
  assert.equal(translate.status, 200);
  assert.equal(translate.body.changedRows, 0);
  assert.match(String(translate.body.message), /対訳を更新/);
  assert.equal((await processCategoryRequest({ action: 'rename', from: '動物', to: '動物', en: 'Beast', ko: '짐승', head: 'head-sha' }, 'admin', d)).status, 403);
});

test('POST rename reports the row count and maps operation errors to their status', async () => {
  const { deps: d } = deps();
  const ok = await json(await processCategoryRequest({ action: 'rename', from: '動物', to: '生き物', en: 'Creature', ko: '생물', head: 'head-sha' }, 'owner', d));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changedRows, 1);
  assert.match(String(ok.body.message), /「動物」を「生き物」に変更しました（1 件の Akyo を更新）/);

  const missing = await json(await processCategoryRequest({ action: 'delete', path: '無い', head: 'head-sha' }, 'owner', d));
  assert.equal(missing.status, 404);
  const invalid = await json(await processCategoryRequest({ action: 'create', path: '動物,鳥', en: 'x', ko: 'x' }, 'owner', d));
  assert.equal(invalid.status, 400);
  assert.match(String(invalid.body.error), /「,」「、」は使えません/);
});

test('POST maps a moved branch to 409 and unexpected failures to 500', async () => {
  const conflict = deps(async () => {
    throw new GitHubConflictError('moved');
  });
  const { status, body } = await json(await processCategoryRequest({ action: 'delete', path: '動物/うま', head: 'head-sha' }, 'owner', conflict.deps));
  assert.equal(status, 409);
  assert.match(String(body.error), /再読み込み/);

  const broken = deps(async () => {
    throw new Error('network down');
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await processCategoryRequest({ action: 'delete', path: '動物/うま', head: 'head-sha' }, 'owner', broken.deps)).status, 500);
  } finally {
    console.error = originalError;
  }
});
