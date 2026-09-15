import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'csv-stringify/sync';
import { processAkyoBatchUpdate, type AkyoBatchDependencies } from './akyo-batch-update';
import { getAkyoEditFields } from './akyo-edit-fields';
import { createAkyoRecord, parseCsvToAkyoData } from './csv-utils';
import { GitHubConflictError } from './github-utils';

const header = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL', 'SourceURL', 'EntryType', 'DisplaySerial', 'BoothURL'];
const url = 'https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc';
const worldUrl = 'https://vrchat.com/home/world/wrld_12345678-1234-1234-1234-123456789abc';

function fixture(registeredCategories = new Set<string>()) {
  const records = ['0001', '0002', '0003'].map((id) => createAkyoRecord({
    id, nickname: `Akyo ${id}`, avatarName: 'Akyo', category: '動物', author: 'Author',
    comment: 'original', entryType: 'avatar', displaySerial: id, sourceUrl: url,
  }, header));
  const data = parseCsvToAkyoData(stringify([header, ...records]));
  const updates = data.slice(0, 2).map((akyo) => {
    const original = getAkyoEditFields(akyo);
    return { original, changes: { ...original, nickname: `${original.nickname} edited`, comment: 'comma, newline\nquoted "value"' } };
  });
  const commits: Parameters<AkyoBatchDependencies['commit']>[0][] = [];
  let loads = 0;
  const dependencies: AkyoBatchDependencies = {
    // The CSV and the category registry come from one commit; categories already carried by
    // a row are always known, and the registry adds those created but not yet assigned.
    loadSnapshot: async () => {
      loads++;
      return { head: 'head-1', header, dataRecords: records, registeredCategories };
    },
    commit: async (args) => {
      commits.push(args);
      return { commit: { html_url: 'https://github.com/example/repo/commit/test' } };
    },
  };
  return { records, data, updates, commits, dependencies, loads: () => loads };
}

for (const count of [1, 2]) {
  test(`${count} updates produce exactly one SHA-guarded commit and preserve unrelated rows`, async () => {
    const f = fixture();
    const before = structuredClone(f.records);
    const response = await processAkyoBatchUpdate(f.updates.slice(0, count), f.dependencies);
    assert.equal(response.status, 200);
    assert.equal(f.loads(), 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.commits[0].parentSha, 'head-1', 'the write applies to the revision the checks used');
    assert.deepEqual(f.records, before, 'input CSV rows must not be mutated');
    assert.deepEqual(f.commits[0].dataRecords[2], before[2]);
    const body = await response.json();
    assert.equal(body.data.length, count);
    assert.equal(body.data[0].comment, f.updates[0].changes.comment);
    assert.equal(body.data[0].displaySerial, '0001');
  });
}

test('invalid last record, duplicate IDs, empty/oversize batches perform no writes', async () => {
  const f = fixture();
  const bad = structuredClone(f.updates);
  bad[1].changes.sourceUrl = 'https://example.com/invalid';
  for (const input of [bad, [f.updates[0], f.updates[0]], [], Array(101).fill(f.updates[0]), [{ changes: {} }]]) {
    assert.equal((await processAkyoBatchUpdate(input, f.dependencies)).status, 400);
  }
  assert.equal(f.commits.length, 0);
  assert.equal(f.loads(), 0);
});

test('concurrent edits and missing records reject the whole batch before committing', async () => {
  for (const deleted of [false, true]) {
    const f = fixture();
    if (deleted) f.records.splice(1, 1);
    else f.records[1][1] = 'Changed by another editor';
    const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
    assert.equal(response.status, 409);
    assert.equal(f.commits.length, 0);
    // 取得し直すだけでは解けないので、取り消す行と、何が重なったかを名指しする
    const { error } = await response.json();
    assert.match(error, deleted ? /#0002 は削除されています/ : /#0002 のニックネームは、別の更新でも変更されています/);
    assert.match(error, /#0002 の保留を取り消し/);
  }
});

// 保留したあとに、同じ行の別の項目が変わった（#572 のデータ PR が作者の表記を揃えた）。
// 行ごとに比べていた頃は、その行を含む保留が、再取得しても二度と反映できなかった
test('a field changed elsewhere is kept, and the held change to another field still applies', async () => {
  const f = fixture(new Set(['対応機種']));
  f.records[1][header.indexOf('Author')] = 'Author (renamed elsewhere)';
  const [first, second] = f.updates;
  second.changes.category = '動物,対応機種';
  const response = await processAkyoBatchUpdate([first, second], f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
  const row = f.commits[0].dataRecords[1];
  assert.equal(row[header.indexOf('Author')], 'Author (renamed elsewhere)', 'the other update must not be rolled back');
  assert.equal(row[header.indexOf('Category')], '動物,対応機種');
  assert.equal(row[header.indexOf('Nickname')], 'Akyo 0002 edited');
  const { data } = await response.json();
  assert.equal(data[1].author, 'Author (renamed elsewhere)', 'the screen receives the row as saved');
});

test('the same change made on both sides is not a conflict', async () => {
  const f = fixture();
  f.records[1][header.indexOf('Nickname')] = f.updates[1].changes.nickname;
  const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
});

test('a category cell only reordered elsewhere does not conflict with a held category edit', async () => {
  const f = fixture(new Set(['動物/いぬ']));
  f.records[1][header.indexOf('Category')] = '動物/うま,動物';
  const [, second] = f.updates;
  second.original.category = '動物,動物/うま';
  second.changes.category = '動物,動物/うま,動物/いぬ';
  const response = await processAkyoBatchUpdate([second], f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits[0].dataRecords[1][header.indexOf('Category')], '動物,動物/うま,動物/いぬ');
});

test('a held change that cannot be saved together with the change made elsewhere is refused', async () => {
  const f = fixture();
  // 保存先の #0002 は BOOTH URL を持たない（別の更新が外した）。保留したときの画面は持っていた
  const [base] = parseCsvToAkyoData(stringify([header, createAkyoRecord({
    id: '0002', nickname: 'Akyo 0002', avatarName: 'Akyo', category: '動物', author: 'Author', comment: 'original',
    entryType: 'avatar', displaySerial: '0002', sourceUrl: url, boothUrl: 'https://booth.pm/ja/items/123',
  }, header)]));
  const original = getAkyoEditFields(base);
  // こちらは VRChat URL を外して BOOTH 専用にした。片方ずつなら保存できるが、合わせると URL が残らない
  const changes = { ...original, entryType: 'booth', sourceUrl: '', avatarName: '' };
  const response = await processAkyoBatchUpdate([{ original, changes }], f.dependencies);
  assert.equal(response.status, 409);
  const { error } = await response.json();
  assert.match(error, /#0002 は、別の更新と合わせると保存できない内容になります/);
  assert.equal(f.commits.length, 0);
});

test('JSON-normalized newlines and category ancestors do not create false conflicts', async () => {
  const f = fixture();
  f.records[0][3] = 'Parent/Child,Parent,Other';
  f.records[0][4] = 'first\r\nsecond';
  f.updates[0].original.category = 'Parent,Parent/Child,Other';
  f.updates[0].original.comment = 'first\nsecond';
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
});

test('multiple world conversions allocate distinct serials and world ancestors', async () => {
  const f = fixture();
  for (const update of f.updates) Object.assign(update.changes, {
    entryType: 'world', sourceUrl: worldUrl, displaySerial: '', avatarName: '',
  });
  const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((row: { displaySerial: string }) => row.displaySerial), ['0001', '0002']);
  assert.ok(data.every((row: { category: string }) => row.category.includes('ワールド')));
});

test('multiple BOOTH conversions allocate distinct serials', async () => {
  const f = fixture();
  for (const update of f.updates) Object.assign(update.changes, {
    entryType: 'booth', sourceUrl: '', boothUrl: 'https://booth.pm/ja/items/123', avatarName: '',
  });
  const response = await processAkyoBatchUpdate(f.updates, f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((row: { displaySerial: string }) => row.displaySerial), ['Booth0001', 'Booth0002']);
});

test('GitHub conflict is not retried or reported as success', async (t) => {
  const f = fixture();
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  f.dependencies.commit = async () => { calls++; throw new Error('GitHub commit failed: 409'); };
  assert.equal((await processAkyoBatchUpdate(f.updates, f.dependencies)).status, 500);
  assert.equal(calls, 1);
});

test('clearing comments and BOOTH links is saved without reviving legacy aliases', async () => {
  const f = fixture();
  f.updates[0].changes.comment = '';
  f.updates[0].changes.boothUrl = '';
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data[0].comment, '');
  assert.equal(data[0].notes, '');
  assert.equal(data[0].boothUrl, undefined);
});

test('category-only avatar/world/BOOTH edits preserve every other CSV column in one commit', async () => {
  const f = fixture();
  f.records[1] = createAkyoRecord({ id: '0002', nickname: 'World', avatarName: 'Stored world name',
    author: 'World author', category: 'ワールド', comment: 'World notes', sourceUrl: worldUrl,
    entryType: 'world', displaySerial: '0012' }, header);
  f.records[2] = createAkyoRecord({ id: '0003', nickname: 'Booth item', avatarName: '', author: 'Seller',
    category: 'Booth', comment: 'Item notes', boothUrl: 'https://booth.pm/ja/items/123', displaySerial: 'Booth0001' }, header);
  const originalData = parseCsvToAkyoData(stringify([header, ...f.records]));
  const updates = originalData.map((akyo) => {
    const original = getAkyoEditFields(akyo);
    return { original, changes: { ...original, category: `${original.category},技能・特性,技能・特性/演奏` } };
  });
  const response = await processAkyoBatchUpdate(updates, {
    ...f.dependencies,
    loadSnapshot: async () => ({
      head: 'head-1', header, dataRecords: f.records,
      registeredCategories: new Set(['技能・特性', '技能・特性/演奏']),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(f.commits.length, 1);
  for (const [index, row] of f.commits[0].dataRecords.entries()) {
    for (const [column, name] of header.entries()) {
      if (name !== 'Category') assert.equal(row[column], f.records[index][column], `${index}: ${name}`);
    }
    assert.ok(row[header.indexOf('Category')].includes('技能・特性/演奏'));
  }
});

// 一括側も同じ形に揃える。画面が親を足し忘れた行を通すと、カードでは正しく見えるのに
// 絞り込み（完全一致）から消えるという、気付けない壊れ方をする
test('a child submitted without its parent is written with the ancestors filled in', async () => {
  const f = fixture(new Set(['動物/うま']));
  f.updates[0].changes.category = '動物/うま';
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data[0].category, '動物,動物/うま');
});

test('a category no row carries and the registry does not know is refused before committing', async () => {
  const f = fixture();
  const carried = f.updates[0].original.category;
  f.updates[0].changes.category = `${carried},存在しないカテゴリ`;
  const response = await processAkyoBatchUpdate([f.updates[0]], f.dependencies);
  assert.equal(response.status, 400);
  const { error } = await response.json();
  assert.match(error, /存在しないカテゴリが含まれています: 存在しないカテゴリ/);
  assert.match(error, /再読み込み/);
  assert.equal(f.commits.length, 0);

  // Registered but not yet used by any Akyo: assigning it for the first time must work.
  const fresh = fixture(new Set(['新カテゴリ']));
  fresh.updates[0].changes.category = `${carried},新カテゴリ`;
  const accepted = await processAkyoBatchUpdate([fresh.updates[0]], fresh.dependencies);
  assert.equal(accepted.status, 200);
  assert.equal(fresh.commits.length, 1);
});

test('a branch that moved between the snapshot and the write is reported as a conflict', async (t) => {
  const f = fixture();
  t.mock.method(console, 'error', () => {});
  // A category deleted meanwhile only rewrites the translations file, so guarding the CSV
  // alone would miss it; the non-force ref update on the read revision is what catches it.
  const response = await processAkyoBatchUpdate(f.updates, {
    ...f.dependencies,
    commit: async () => {
      throw new GitHubConflictError('Update is not a fast forward');
    },
  });
  assert.equal(response.status, 409);
  const { error } = await response.json();
  assert.match(error, /再読み込み/);
});
