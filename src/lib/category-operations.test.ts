import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CategoryOperationError,
  createCategory,
  deleteCategory,
  mergeCategory,
  renameCategory,
  serializeCategoryColors,
  serializeCategoryTranslations,
  summarizeCategories,
  translateCategory,
  validateCategoryPath,
  withAncestors,
  type CategoryDataset,
} from './category-operations';

const HEADER = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL'];

function row(id: string, category: string): string[] {
  return [id, `${id}Akyo`, `avatar_${id}`, category, '', 'tester', `https://vrchat.com/home/avatar/avtr_${id}`];
}

function dataset(): CategoryDataset {
  return {
    header: HEADER,
    records: [
      row('0001', '動物,動物/うま'),
      row('0002', '動物,動物/うま,動物/うま/ポニー'),
      row('0003', '乗り物'),
      row('0004', '動物'),
      row('0005', 'ワールド'),
      row('0006', '未翻訳'),
    ],
    translations: {
      '動物': { en: 'Animal', ko: '동물' },
      '動物/うま': { en: 'Animal/Horse', ko: '동물/말' },
      '動物/うま/ポニー': { en: 'Animal/Horse/Pony', ko: '동물/말/포니' },
      '乗り物': { en: 'Vehicle', ko: '탈것' },
      'ワールド': { en: 'World', ko: '월드' },
      '空箱': { en: 'Empty Box', ko: '빈 상자' },
    },
    colors: { '動物': '#111111', '乗り物': '#222222', '空箱': '#333333' },
  };
}

function categoriesOf(records: string[][], id: string): string {
  const record = records.find((entry) => entry[0] === id);
  assert.ok(record, `row ${id}`);
  return record[3];
}

test('withAncestors: inserts missing ancestors before the token and drops duplicates', () => {
  assert.deepEqual(withAncestors(['乗り物/うま/ポニー', '乗り物', '動物']), ['乗り物', '乗り物/うま', '乗り物/うま/ポニー', '動物']);
});

test('validateCategoryPath: rejects separators, blank levels and formula prefixes', () => {
  assert.equal(validateCategoryPath('動物/うま'), '動物/うま');
  for (const bad of ['', ' 動物', '動物,鳥', '動物、鳥', '動物/', '/動物', '動物//うま', '動物/ うま', '=SUM', '動物/-x', '__proto__']) {
    assert.throws(() => validateCategoryPath(bad), CategoryOperationError, bad);
  }
});

test('rename: moves the node and every descendant in rows, translations and colours', () => {
  const change = renameCategory(dataset(), { from: '動物', to: '生き物', en: 'Creature', ko: '생물' });
  assert.equal(change.changedRows, 3);
  assert.equal(categoriesOf(change.dataset.records, '0001'), '生き物,生き物/うま');
  assert.equal(categoriesOf(change.dataset.records, '0002'), '生き物,生き物/うま,生き物/うま/ポニー');
  assert.equal(categoriesOf(change.dataset.records, '0003'), '乗り物');
  assert.deepEqual(change.dataset.translations['生き物'], { en: 'Creature', ko: '생물' });
  assert.deepEqual(change.dataset.translations['生き物/うま'], { en: 'Creature/Horse', ko: '생물/말' });
  assert.deepEqual(change.dataset.translations['生き物/うま/ポニー'], { en: 'Creature/Horse/Pony', ko: '생물/말/포니' });
  assert.equal(Object.hasOwn(change.dataset.translations, '動物'), false);
  assert.equal(Object.hasOwn(change.dataset.translations, '動物/うま'), false);
  assert.deepEqual(change.dataset.colors, { '生き物': '#111111', '乗り物': '#222222', '空箱': '#333333' });
  assert.match(change.message, /Rename category 動物 → 生き物 \(3 rows\)/);
  // The input is not mutated.
  assert.equal(categoriesOf(dataset().records, '0001'), '動物,動物/うま');
});

test('rename: moving under another parent inserts the new ancestor and keeps the old parent token', () => {
  const change = renameCategory(dataset(), { from: '動物/うま', to: '乗り物/うま', en: 'Horse', ko: '말' });
  assert.equal(change.changedRows, 2);
  assert.equal(categoriesOf(change.dataset.records, '0001'), '動物,乗り物,乗り物/うま');
  assert.equal(categoriesOf(change.dataset.records, '0002'), '動物,乗り物,乗り物/うま,乗り物/うま/ポニー');
  assert.deepEqual(change.dataset.translations['乗り物/うま'], { en: 'Vehicle/Horse', ko: '탈것/말' });
  assert.deepEqual(change.dataset.translations['乗り物/うま/ポニー'], { en: 'Vehicle/Horse/Pony', ko: '탈것/말/포니' });
  assert.deepEqual(change.dataset.colors, dataset().colors);
});

test('rename: a promoted child keeps its former top-level colour, a demoted top-level drops its entry', () => {
  const promoted = renameCategory(dataset(), { from: '動物/うま', to: 'うま', en: 'Horse', ko: '말' });
  assert.equal(promoted.dataset.colors['うま'], '#111111');
  assert.equal(categoriesOf(promoted.dataset.records, '0002'), '動物,うま,うま/ポニー');
  const demoted = renameCategory(dataset(), { from: '乗り物', to: '動物/乗り物', en: 'Vehicle', ko: '탈것' });
  assert.equal(Object.hasOwn(demoted.dataset.colors, '乗り物'), false);
  assert.equal(categoriesOf(demoted.dataset.records, '0003'), '動物,動物/乗り物');
  assert.deepEqual(demoted.dataset.translations['動物/乗り物'], { en: 'Animal/Vehicle', ko: '동물/탈것' });
});

test('rename: refuses existing targets, own descendants, protected and unknown categories', () => {
  const base = dataset();
  assert.throws(
    () => renameCategory(base, { from: '乗り物', to: '動物', en: 'x', ko: 'x' }),
    (error: unknown) => error instanceof CategoryOperationError && error.status === 409,
  );
  assert.throws(() => renameCategory(base, { from: '動物', to: '動物/うま/動物', en: 'x', ko: 'x' }), /自分の配下/);
  assert.throws(() => renameCategory(base, { from: 'ワールド', to: '世界', en: 'x', ko: 'x' }), /自動で扱う/);
  assert.throws(() => renameCategory(base, { from: '動物', to: 'Booth/動物', en: 'x', ko: 'x' }), /自動で扱う/);
  assert.throws(
    () => renameCategory(base, { from: '存在しない', to: 'x', en: 'x', ko: 'x' }),
    (error: unknown) => error instanceof CategoryOperationError && error.status === 404,
  );
  assert.throws(() => renameCategory(base, { from: '動物', to: '生き物/動物', en: 'x', ko: 'x' }), /親カテゴリ「生き物」が存在しません/);
  assert.throws(() => renameCategory(base, { from: '動物', to: '生き物', en: 'Ani/mal', ko: 'x' }), /「\/」は使えません/);
  assert.throws(() => renameCategory(base, { from: '動物', to: '生き物', en: '', ko: 'x' }), /英語名を入力/);
});

test('rename with the same path only updates the translations (children follow the prefix)', () => {
  const change = renameCategory(dataset(), { from: '動物', to: '動物', en: 'Beast', ko: '짐승' });
  assert.equal(change.changedRows, 0);
  assert.deepEqual(change.dataset.translations['動物'], { en: 'Beast', ko: '짐승' });
  assert.deepEqual(change.dataset.translations['動物/うま/ポニー'], { en: 'Beast/Horse/Pony', ko: '짐승/말/포니' });
  assert.equal(categoriesOf(change.dataset.records, '0001'), '動物,動物/うま');
});

test('translate: gives an existing untranslated token its names', () => {
  const change = translateCategory(dataset(), { path: '未翻訳', en: 'Untranslated', ko: '미번역' });
  assert.equal(change.changedRows, 0);
  assert.deepEqual(change.dataset.translations['未翻訳'], { en: 'Untranslated', ko: '미번역' });
  assert.throws(() => translateCategory(dataset(), { path: '無い', en: 'x', ko: 'x' }), /存在しません/);
});

test('merge: folds the source and its descendants into the target and drops its translations', () => {
  const change = mergeCategory(dataset(), { from: '乗り物', into: '動物' });
  assert.equal(change.changedRows, 1);
  assert.equal(categoriesOf(change.dataset.records, '0003'), '動物');
  assert.equal(Object.hasOwn(change.dataset.translations, '乗り物'), false);
  assert.equal(Object.hasOwn(change.dataset.colors, '乗り物'), false);
  assert.deepEqual(change.dataset.translations['動物'], { en: 'Animal', ko: '동물' });

  const withChildren = mergeCategory(dataset(), { from: '動物/うま', into: '乗り物' });
  assert.equal(withChildren.changedRows, 2);
  assert.equal(categoriesOf(withChildren.dataset.records, '0001'), '動物,乗り物');
  assert.equal(categoriesOf(withChildren.dataset.records, '0002'), '動物,乗り物,乗り物/ポニー');
  assert.deepEqual(withChildren.dataset.translations['乗り物/ポニー'], { en: 'Vehicle/Pony', ko: '탈것/포니' });
  assert.equal(Object.hasOwn(withChildren.dataset.translations, '動物/うま'), false);
});

test('merge: refuses parent/child pairs, identical paths, protected and untranslated targets', () => {
  const base = dataset();
  assert.throws(() => mergeCategory(base, { from: '動物/うま', into: '動物' }), /親子関係/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '動物/うま' }), /親子関係/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '動物' }), /同じ/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: 'ワールド' }), /自動で扱う/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '未翻訳' }), /対訳がありません/);
});

test('delete: removes the node and descendants from rows, translations and colours', () => {
  const change = deleteCategory(dataset(), { path: '動物/うま' });
  assert.equal(change.changedRows, 2);
  assert.equal(categoriesOf(change.dataset.records, '0001'), '動物');
  assert.equal(categoriesOf(change.dataset.records, '0002'), '動物');
  assert.equal(Object.hasOwn(change.dataset.translations, '動物/うま'), false);
  assert.equal(Object.hasOwn(change.dataset.translations, '動物/うま/ポニー'), false);
  assert.deepEqual(change.dataset.colors, dataset().colors);

  const topLevel = deleteCategory(dataset(), { path: '動物' });
  assert.equal(topLevel.changedRows, 3);
  assert.equal(categoriesOf(topLevel.dataset.records, '0004'), '');
  assert.equal(Object.hasOwn(topLevel.dataset.colors, '動物'), false);
  assert.throws(() => deleteCategory(dataset(), { path: 'Booth' }), /自動で扱う/);
});

test('create: composes EN/KO from the parent, freezes a colour for a new top-level', () => {
  const child = createCategory(dataset(), { path: '動物/ねこ', en: 'Cat', ko: '고양이' });
  assert.equal(child.changedRows, 0);
  assert.deepEqual(child.dataset.translations['動物/ねこ'], { en: 'Animal/Cat', ko: '동물/고양이' });
  assert.deepEqual(child.dataset.colors, dataset().colors);

  const top = createCategory(dataset(), { path: '道具', en: 'Tool', ko: '도구' });
  assert.match(top.dataset.colors['道具'], /^#[0-9a-f]{6}$/);

  const base = dataset();
  assert.throws(
    () => createCategory(base, { path: '動物', en: 'x', ko: 'x' }),
    (error: unknown) => error instanceof CategoryOperationError && error.status === 409,
  );
  assert.throws(() => createCategory(base, { path: '空箱', en: 'x', ko: 'x' }), /既に存在/);
  assert.throws(() => createCategory(base, { path: '植物/木', en: 'Tree', ko: '나무' }), /親カテゴリ「植物」が存在しません/);
  assert.throws(() => createCategory(base, { path: '未翻訳/子', en: 'Child', ko: '아이' }), /親カテゴリ「未翻訳」に対訳がありません/);
  // Prototype names are neither "existing" nor special once stored as own properties.
  const prototypeName = createCategory(base, { path: 'constructor', en: 'Constructor', ko: '생성자' });
  assert.equal(Object.hasOwn(prototypeName.dataset.translations, 'constructor'), true);
  assert.throws(() => createCategory(base, { path: '__proto__', en: 'x', ko: 'x' }), /__proto__/);
  assert.throws(() => createCategory(base, { path: '動物/__proto__', en: 'x', ko: 'x' }), /__proto__/);
});

test('summarizeCategories: counts rows per path including descendants, merges CSV tokens and table keys', () => {
  const summary = summarizeCategories(dataset());
  const byPath = new Map(summary.map((entry) => [entry.path, entry]));
  assert.equal(byPath.get('動物')?.count, 3);
  assert.equal(byPath.get('動物/うま')?.count, 2);
  assert.equal(byPath.get('動物/うま/ポニー')?.count, 1);
  assert.deepEqual(byPath.get('未翻訳'), { path: '未翻訳', en: null, ko: null, count: 1 });
  assert.deepEqual(byPath.get('空箱'), { path: '空箱', en: 'Empty Box', ko: '빈 상자', count: 0 });
});

test('serialization sorts keys and ends with a newline', () => {
  assert.equal(serializeCategoryColors({ 'b': '#000000', 'a': '#ffffff' }), '{\n  "a": "#ffffff",\n  "b": "#000000"\n}\n');
  const text = serializeCategoryTranslations({ '動物/うま': { en: 'Animal/Horse', ko: '동물/말' }, '動物': { en: 'Animal', ko: '동물' } });
  assert.deepEqual(Object.keys(JSON.parse(text)), ['動物', '動物/うま']);
});
