import assert from 'node:assert/strict';
import test from 'node:test';

import { findCreateBlocker, planCategoryCreateLevels } from './category-create-levels';

const EXISTING = ['動物', '動物/うま', '色'];

test('既存の階層と新しい階層を、上から順に見分ける', () => {
  assert.deepEqual(planCategoryCreateLevels('色/赤色系', EXISTING), [
    { path: '色', segment: '色', exists: true, similarTo: [] },
    { path: '色/赤色系', segment: '赤色系', exists: false, similarTo: [] },
  ]);
});

test('親も子も新しいときは、両方が入力対象になる', () => {
  // ここが空になると「新しい親/新しい子」を作る手段が無くなる
  assert.deepEqual(planCategoryCreateLevels('植物/木', EXISTING), [
    { path: '植物', segment: '植物', exists: false, similarTo: [] },
    { path: '植物/木', segment: '木', exists: false, similarTo: [] },
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

test('既存判定はサーバーと同じ完全一致で行い、表記ゆれは別に知らせる', () => {
  // 表記ゆれを吸収して「既存」と見なすと、サーバーが対訳を要求する階層の入力欄を
  // 画面が出さず、画面上に満たす手段が無いエラーになる。一方で黙って作らせると
  // 見た目が同じカテゴリが 2 つ並ぶので、似ている既存を添えて画面が止める
  const nfd = planCategoryCreateLevels('ガ/子', ['ガ'.normalize('NFD')])[0];
  assert.equal(nfd?.exists, false);
  assert.deepEqual(nfd?.similarTo, ['ガ'.normalize('NFD')]);

  const casing = planCategoryCreateLevels('Cat', ['cat'])[0];
  assert.equal(casing?.exists, false);
  assert.deepEqual(casing?.similarTo, ['cat']);

  const same = planCategoryCreateLevels('Cat', ['Cat'])[0];
  assert.equal(same?.exists, true);
  assert.deepEqual(same?.similarTo, [], '完全一致なら似ているとは言わない');

  assert.deepEqual(planCategoryCreateLevels('植物', ['動物'])[0]?.similarTo, []);
});

test('紛らわしい既存は全部返し、止める理由をまとめて出す', () => {
  // 1 つだけ選ぶと、どれが選ばれたかが一覧の並び順任せになる
  const levels = planCategoryCreateLevels('動物/Cat', ['動物', 'cat', '動物/CAT', '動物/cat']);
  assert.deepEqual(levels[1]?.similarTo, ['動物/CAT', '動物/cat']);
  assert.match(
    String(findCreateBlocker(levels)),
    /「動物\/Cat」は既存の「動物\/CAT」「動物\/cat」と/,
  );

  // 複数の階層が紛らわしいなら 1 回で全部言う。直して送り直しを繰り返させない
  const two = findCreateBlocker(planCategoryCreateLevels('cat/dog', ['Cat', 'cat/Dog']));
  assert.match(String(two), /「cat」は既存の「Cat」、「cat\/dog」は既存の「cat\/Dog」/);

  assert.equal(
    findCreateBlocker(planCategoryCreateLevels('動物/ねこ', ['動物'])),
    undefined,
    '紛らわしくなければ止めない',
  );
  assert.equal(
    findCreateBlocker(planCategoryCreateLevels('動物/うま', ['動物', '動物/うま'])),
    'このカテゴリは既に存在します',
    '完全一致は「既にある」と言う',
  );
});

test('入力途中の形は何も訊かない', () => {
  assert.deepEqual(planCategoryCreateLevels('', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('   ', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('色/', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('/色', EXISTING), []);
  assert.deepEqual(planCategoryCreateLevels('色//赤', EXISTING), []);
});
