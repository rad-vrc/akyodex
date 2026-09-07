import assert from 'node:assert/strict';
import test from 'node:test';

import { planCategoryCreateLevels } from './category-create-levels';

const EXISTING = ['動物', '動物/うま', '色'];

test('既存の階層と新しい階層を、上から順に見分ける', () => {
  assert.deepEqual(planCategoryCreateLevels('色/赤色系', EXISTING), [
    { path: '色', segment: '色', exists: true },
    { path: '色/赤色系', segment: '赤色系', exists: false },
  ]);
});

test('親も子も新しいときは、両方が入力対象になる', () => {
  // ここが空になると「新しい親/新しい子」を作る手段が無くなる
  assert.deepEqual(planCategoryCreateLevels('植物/木', EXISTING), [
    { path: '植物', segment: '植物', exists: false },
    { path: '植物/木', segment: '木', exists: false },
  ]);
});

test('途中の階層だけ足りない場合も拾う', () => {
  const levels = planCategoryCreateLevels('動物/とり/インコ', EXISTING);
  assert.deepEqual(
    levels.map((level) => [level.path, level.exists]),
    [
      ['動物', true],
      ['動物/とり', false],
      ['動物/とり/インコ', false],
    ],
  );
});

test('既存判定は NFC と大文字小文字を無視する', () => {
  const levels = planCategoryCreateLevels('ガ/子', ['ガ'.normalize('NFD')]);
  assert.equal(levels[0]?.exists, true);
  assert.equal(planCategoryCreateLevels('Cat', ['cat'])[0]?.exists, true);
});

test('入力途中の形は何も訊かない', () => {
  assert.deepEqual(planCategoryCreateLevels('', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('   ', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('色/', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('/色', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('色//赤', EXISTING), []);
});
