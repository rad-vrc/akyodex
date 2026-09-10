import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCategories, changesUnderMode, hasAllCategories, stageCategoryUpdate } from './category-assignment';
import type { AkyoData } from '@/types/akyo';

const akyo: AkyoData = {
  id: '0001', nickname: 'うまAkyo', avatarName: 'horse', author: 'a', creator: 'a',
  category: '動物,動物/うま', attribute: '動物,動物/うま', comment: '', notes: '', appearance: '',
  entryType: 'avatar', displaySerial: '0001',
  sourceUrl: 'https://vrchat.com/home/avatar/avtr_1', avatarUrl: 'https://vrchat.com/home/avatar/avtr_1',
};

test('hasAllCategories: AND over the selected set, never true for an empty set', () => {
  assert.equal(hasAllCategories(['動物', '動物/うま'], ['動物', '動物/うま']), true);
  assert.equal(hasAllCategories(['動物'], ['動物', '動物/うま']), false);
  assert.equal(hasAllCategories(['動物'], []), false);
});

test('applyCategories: 付けるときは祖先ごと足し、外すときは子孫ごと外す', () => {
  // 足りない分を足す（祖先も）。関係ないトークンはそのまま
  assert.deepEqual(applyCategories(['乗り物'], ['動物/うま', '次元'], 'attach'), ['乗り物', '動物', '動物/うま', '次元']);
  // 外すと、その下も一緒に外れる。関係ないトークンは残る
  assert.deepEqual(applyCategories(['動物', '動物/うま', '動物/うま/ポニー', '乗り物'], ['動物/うま'], 'detach'), ['動物', '乗り物']);
  // 親を外すと、選択に入っていない子も外れる
  assert.deepEqual(applyCategories(['動物', '動物/うま', '乗り物'], ['動物'], 'detach'), ['乗り物']);
  assert.deepEqual(applyCategories(['動物'], [], 'attach'), ['動物']);
  assert.deepEqual(applyCategories(['動物'], [], 'detach'), ['動物']);
});

/*
 * 向きはモードで決まる。押したカードの状態では決めない。
 *
 * 以前は 1 クリックのトグルで、既に全部持つ Akyo を押すと外れた。既に持っているカードは
 * 最初から選択状態で表示されるので、いま自分で選んだカードと見分けが付かず、付ける作業の
 * 途中で押すと警告も無く外れた（2026-09-10、#0926 が対応機種/PC を失った）。
 */
test('applyCategories: 既に全部持つ Akyo を「付ける」で押しても外れない', () => {
  const owns = ['動物', '動物/うま', '対応機種', '対応機種/PC'];
  assert.deepEqual(applyCategories(owns, ['対応機種/PC'], 'attach'), owns, '付けるモードで外れてはいけない');
  assert.deepEqual(applyCategories(owns, ['動物'], 'attach'), owns);
  // 外すのは外すモードのときだけ
  assert.deepEqual(applyCategories(owns, ['対応機種/PC'], 'detach'), ['動物', '動物/うま', '対応機種']);
});

test('changesUnderMode: そのモードで変わらないカードを見分ける', () => {
  const owns = ['動物', '動物/うま', '対応機種', '対応機種/PC'];
  // 既に全部持つ → 付けるモードでは何も起きない（＝押させない）
  assert.equal(changesUnderMode(owns, ['対応機種/PC'], 'attach'), false);
  assert.equal(changesUnderMode(owns, ['対応機種/PC'], 'detach'), true);
  // 持っていない → 外すモードでは何も起きない
  assert.equal(changesUnderMode(['動物'], ['対応機種/PC'], 'detach'), false);
  assert.equal(changesUnderMode(['動物'], ['対応機種/PC'], 'attach'), true);
  // 選択が空なら、どちらのモードでも変わらない
  assert.equal(changesUnderMode(owns, [], 'attach'), false);
  assert.equal(changesUnderMode(owns, [], 'detach'), false);
});

/*
 * 判定は stageCategoryUpdate と同じ基準（sameAkyoEditFields）で行う。トークン列を単純に
 * 比べると、祖先を補うだけの差で「変わる」と答えてしまい、押せるのに stageCategoryUpdate
 * が null を返して何も起きないカードができる。押しても何も起きないカードを無くすのが
 * この関数の目的なので、基準がずれていては意味がない。
 */
test('changesUnderMode: 祖先を補うだけの差を「変わる」と答えない', () => {
  const tokens = ['動物/うま'];
  // 適用すると 動物 が増えるが、CSV→JSON が祖先を入れるので保存内容としては同じ
  assert.deepEqual(applyCategories(tokens, ['動物'], 'attach'), ['動物', '動物/うま']);
  assert.equal(stageCategoryUpdate(akyo, undefined, ['動物', '動物/うま']), null, '前提: 保留は作られない');
  assert.equal(changesUnderMode(tokens, ['動物'], 'attach'), false, '押せるのに何も起きないカードを作らない');

  // 本当に増える場合はこれまでどおり true
  assert.equal(changesUnderMode(tokens, ['次元'], 'attach'), true);
});

test('stageCategoryUpdate: keeps the first original, drops a change that returns to it', () => {
  const staged = stageCategoryUpdate(akyo, undefined, ['動物', '動物/うま', '次元']);
  assert.ok(staged);
  assert.equal(staged.original.category, '動物,動物/うま');
  assert.equal(staged.changes.category, '動物,動物/うま,次元');
  assert.equal(staged.changes.id, '0001');
  const back = stageCategoryUpdate(akyo, staged, ['動物', '動物/うま']);
  assert.equal(back, null);
  // Ancestor-only differences are not changes (the CSV→JSON step inserts them anyway).
  assert.equal(stageCategoryUpdate(akyo, undefined, ['動物/うま']), null);
});
