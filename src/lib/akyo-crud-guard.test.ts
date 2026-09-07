import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'csv-stringify/sync';

import { processAkyoCRUD, type AkyoCrudDependencies } from './akyo-crud-helpers';
import type { AkyoCsvCommit, AkyoCsvSnapshot } from './akyo-csv-snapshot';
import type { AkyoFormData } from './api-helpers';
import { createAkyoRecord, parseCsvToAkyoData } from './csv-utils';
import { GitHubConflictError } from './github-utils';

/**
 * Registering or editing one Akyo writes categories just like the batch path, so the same two
 * rules must hold: an unknown category cannot be written, and the write applies to the
 * revision the checks read (a category deleted meanwhile only rewrites the translations file).
 */

const header = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL', 'SourceURL', 'EntryType', 'DisplaySerial', 'BoothURL'];
const url = 'https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc';

function fixture(registeredCategories = new Set<string>()) {
  const records = ['0001', '0002'].map((id) => createAkyoRecord({
    id, nickname: `Akyo ${id}`, avatarName: 'Akyo', category: '動物', author: 'Author',
    comment: 'original', entryType: 'avatar', displaySerial: id, sourceUrl: url,
  }, header));
  const commits: AkyoCsvCommit[] = [];
  const snapshot: AkyoCsvSnapshot = { head: 'head-1', header, dataRecords: records, registeredCategories };
  const dependencies: AkyoCrudDependencies = {
    loadSnapshot: async () => snapshot,
    commit: async (args) => {
      commits.push(args);
      return { commit: { html_url: 'https://github.com/example/repo/commit/test' } };
    },
  };
  return { records, commits, dependencies };
}

function form(overrides: Partial<AkyoFormData> = {}): AkyoFormData {
  return {
    id: '0003', nickname: '新しいAkyo', avatarName: 'akyo_new', entryType: 'avatar',
    displaySerial: '0003', sourceUrl: url, avatarUrl: url, boothUrl: undefined,
    category: '動物', author: 'Author', comment: '', imageData: undefined,
    attributes: '', creator: '', notes: '',
    ...overrides,
  } as AkyoFormData;
}

test('registering with a category no row carries and the registry does not know is refused', async () => {
  const f = fixture();
  const response = await processAkyoCRUD('add', form({ category: '動物,消えたカテゴリ' }), f.dependencies);
  assert.equal(response.status, 400);
  const { error } = await response.json();
  assert.match(error, /存在しないカテゴリが含まれています: 消えたカテゴリ/);
  assert.match(error, /再読み込み/);
  assert.equal(f.commits.length, 0, 'nothing is written');
});

test('a category registered but not yet used by any Akyo can be assigned on registration', async () => {
  const f = fixture(new Set(['新カテゴリ']));
  const response = await processAkyoCRUD('add', form({ category: '動物,新カテゴリ' }), f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].parentSha, 'head-1', 'the write applies to the revision the checks read');
  const saved = parseCsvToAkyoData(stringify([header, ...f.commits[0].dataRecords])).find((akyo) => akyo.id === '0003');
  assert.ok(saved);
  assert.match(saved.category, /新カテゴリ/);
});

// 行は持つトークンの祖先を全部並べる形をしている。子だけの行はカードでは正しく見えるのに
// （親はトークンから切り出される）絞り込みが完全一致なので「動物」から消える。画面が親を
// 足し忘れても、書く側でこの形に揃える
test('a child submitted without its parent is written with the ancestors filled in', async () => {
  const f = fixture(new Set(['動物/うま']));
  const response = await processAkyoCRUD('add', form({ category: '動物/うま' }), f.dependencies);
  assert.equal(response.status, 200);
  const saved = parseCsvToAkyoData(stringify([header, ...f.commits[0].dataRecords])).find((akyo) => akyo.id === '0003');
  assert.ok(saved);
  assert.equal(saved.category, '動物,動物/うま');
});

test('markers the server adds itself are never rejected, and deleting checks no category', async () => {
  const booth = fixture();
  // 'Booth' and 'Booth/アバター' are appended by the server, not submitted by the client.
  const response = await processAkyoCRUD('add', form({
    id: '0004', category: '動物', sourceUrl: '', avatarUrl: '', boothUrl: 'https://booth.pm/ja/items/123',
  }), booth.dependencies);
  assert.equal(response.status, 200);
  assert.match(booth.commits[0].dataRecords.at(-1)![header.indexOf('Category')], /Booth/);

  const removal = fixture();
  assert.equal((await processAkyoCRUD('delete', { id: '0001' }, removal.dependencies)).status, 200);
  assert.equal(removal.commits.length, 1);
});

test('a branch that moved between the snapshot and the write is reported as a conflict', async (t) => {
  const f = fixture();
  t.mock.method(console, 'error', () => {});
  const response = await processAkyoCRUD('add', form(), {
    ...f.dependencies,
    commit: async () => {
      throw new GitHubConflictError('Update is not a fast forward');
    },
  });
  assert.equal(response.status, 409);
  const { error } = await response.json();
  assert.match(error, /再読み込み/);
});
