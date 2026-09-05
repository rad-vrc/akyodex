import assert from 'node:assert/strict';
import test from 'node:test';

import { renameCategory } from './category-operations';
import {
  CATEGORY_FILE_PATHS,
  buildCategoryCommitFiles,
  commitCategoryChange,
  loadCategorySnapshot,
  parseCategoryColors,
  parseCategoryTranslations,
  type CategoryStoreDeps,
} from './category-store';

const CSV = [
  'ID,Nickname,AvatarName,Category,Comment,Author,AvatarURL',
  '0001,うまAkyo,horse,"動物,動物/うま",,tester,https://vrchat.com/home/avatar/avtr_1',
  '0002,くるまAkyo,car,乗り物,,tester,https://vrchat.com/home/avatar/avtr_2',
  '',
].join('\n');
const TRANSLATIONS = JSON.stringify({
  '動物': { en: 'Animal', ko: '동물' },
  '動物/うま': { en: 'Animal/Horse', ko: '동물/말' },
  '乗り物': { en: 'Vehicle', ko: '탈것' },
});
const COLORS = JSON.stringify({ '乗り物': '#222222', '動物': '#111111' });

function deps(overrides: Partial<CategoryStoreDeps> = {}) {
  const calls: { fetched: { path: string; ref?: string }[]; commits: unknown[] } = { fetched: [], commits: [] };
  const base: CategoryStoreDeps = {
    getBranchHead: async () => 'head-sha',
    fetchFile: async (path, _config, _timeout, ref) => {
      calls.fetched.push({ path, ref });
      const content = { [CATEGORY_FILE_PATHS.csv]: CSV, [CATEGORY_FILE_PATHS.translations]: TRANSLATIONS, [CATEGORY_FILE_PATHS.colors]: COLORS }[path];
      if (content === undefined) throw new Error(`unexpected path ${path}`);
      return { content, sha: `sha-${path}` };
    },
    commitFiles: async (args) => {
      calls.commits.push(args);
      return { sha: 'new-sha', commit: { html_url: 'https://github.com/x/y/commit/new-sha' } };
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

test('parseCategoryTranslations / parseCategoryColors validate the shape CI expects', () => {
  assert.deepEqual(parseCategoryTranslations('{"動物":{"en":"Animal","ko":"동물"}}'), { '動物': { en: 'Animal', ko: '동물' } });
  assert.throws(() => parseCategoryTranslations('[]'), /形式が不正/);
  assert.throws(() => parseCategoryTranslations('{"動物":{"en":"Animal"}}'), /ko がありません/);
  assert.throws(() => parseCategoryTranslations('{"動物 ":{"en":"Animal","ko":"동물"}}'), /キー "動物 " が不正/);
  assert.throws(() => parseCategoryTranslations('nope'), /JSON として読めません/);
  assert.deepEqual(parseCategoryColors('{"動物":"#A1b2C3"}'), { '動物': '#A1b2C3' });
  assert.throws(() => parseCategoryColors('{"動物":"red"}'), /色コードではありません/);
});

test('loadCategorySnapshot reads every file at the branch head it fetched first', async () => {
  const { deps: d, calls } = deps();
  const snapshot = await loadCategorySnapshot(d);
  assert.equal(snapshot.head, 'head-sha');
  assert.deepEqual(calls.fetched.map((call) => call.ref), ['head-sha', 'head-sha', 'head-sha']);
  assert.equal(snapshot.dataset.records.length, 2);
  assert.deepEqual(snapshot.dataset.translations['動物/うま'], { en: 'Animal/Horse', ko: '동물/말' });
  // Canonical (sorted) forms, so a merely re-ordered file does not count as a change later.
  assert.equal(snapshot.original.colors, '{\n  "乗り物": "#222222",\n  "動物": "#111111"\n}\n');
});

test('buildCategoryCommitFiles includes only the files an operation changed', async () => {
  const snapshot = await loadCategorySnapshot(deps().deps);
  const rename = renameCategory(snapshot.dataset, { from: '動物', to: '生き物', en: 'Creature', ko: '생물' });
  const files = buildCategoryCommitFiles(snapshot, rename);
  assert.deepEqual(files.map((file) => file.path), [CATEGORY_FILE_PATHS.csv, CATEGORY_FILE_PATHS.translations, CATEGORY_FILE_PATHS.colors]);
  assert.match(files[0].content, /"生き物,生き物\/うま"/);
  assert.match(files[0].content, /"0002","くるまAkyo"/);
  assert.equal(files[0].content.includes('\r'), false);

  const translateOnly = renameCategory(snapshot.dataset, { from: '乗り物', to: '乗り物', en: 'Vehicles', ko: '탈것' });
  assert.deepEqual(buildCategoryCommitFiles(snapshot, translateOnly).map((file) => file.path), [CATEGORY_FILE_PATHS.translations]);

  const childRename = renameCategory(snapshot.dataset, { from: '動物/うま', to: '動物/ウマ', en: 'Horse', ko: '말' });
  assert.deepEqual(buildCategoryCommitFiles(snapshot, childRename).map((file) => file.path), [CATEGORY_FILE_PATHS.csv, CATEGORY_FILE_PATHS.translations]);
});

test('commitCategoryChange commits on top of the snapshot head and refuses empty changes', async () => {
  const { deps: d, calls } = deps();
  const snapshot = await loadCategorySnapshot(d);
  const rename = renameCategory(snapshot.dataset, { from: '動物', to: '生き物', en: 'Creature', ko: '생물' });
  const result = await commitCategoryChange(snapshot, rename, d);
  assert.equal(result.sha, 'new-sha');
  assert.deepEqual(result.files, [CATEGORY_FILE_PATHS.csv, CATEGORY_FILE_PATHS.translations, CATEGORY_FILE_PATHS.colors]);
  const commit = calls.commits[0] as { parentSha: string; message: string };
  assert.equal(commit.parentSha, 'head-sha');
  assert.match(commit.message, /^Rename category 動物 → 生き物/);

  const noop = renameCategory(snapshot.dataset, { from: '乗り物', to: '乗り物', en: 'Vehicle', ko: '탈것' });
  await assert.rejects(() => commitCategoryChange(snapshot, noop, d), /変更がありません/);
  assert.equal(calls.commits.length, 1);
});
