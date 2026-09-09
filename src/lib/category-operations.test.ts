import assert from 'node:assert/strict';
import test from 'node:test';

import { getCategoryColor } from './akyo-data-helpers';
import categoryColors from './category-colors.json';
import {
  CategoryOperationError,
  assertTranslationHierarchy,
  createCategory,
  deleteCategory,
  ensureCategoryAncestors,
  listCategoryColors,
  mergeCategory,
  recolorCategory,
  renameCategory,
  selectCategoryPath,
  serializeCategoryColors,
  serializeCategoryTranslations,
  summarizeCategories,
  toggleCategoryPath,
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

test('ensureCategoryAncestors: completes a cell, leaves a complete one byte-for-byte', () => {
  assert.equal(ensureCategoryAncestors('色/紫色系'), '色,色/紫色系');
  assert.equal(ensureCategoryAncestors('動物,色/紫色系/薄紫'), '動物,色,色/紫色系,色/紫色系/薄紫');
  // 足りていないものが無ければ、区切りも並びもそのまま返す
  assert.equal(ensureCategoryAncestors('色/紫色系、色'), '色/紫色系、色');
  assert.equal(ensureCategoryAncestors(''), '');
  // 落とした重複と補った祖先の数が打ち消し合う形。長さで見ていると素通りする
  assert.equal(ensureCategoryAncestors('色/紫色系,色/紫色系'), '色,色/紫色系');
});

test('selectCategoryPath: fills in the ancestors of the picked path only', () => {
  assert.deepEqual(selectCategoryPath([], '色/紫色系/薄紫'), ['色', '色/紫色系', '色/紫色系/薄紫']);
  // 既に選んである祖先は動かさず、足りない分だけ後ろに足す
  assert.deepEqual(selectCategoryPath(['動物', '色'], '色/紫色系'), ['動物', '色', '色/紫色系']);
  // 押していないトークンの欠けた祖先までは補わない（並びが勝手に変わる）
  assert.deepEqual(selectCategoryPath(['動物/うま'], '色'), ['動物/うま', '色']);
});

test('toggleCategoryPath: clearing a path clears its descendants, clearing a child does not', () => {
  const selected = ['動物', '色', '色/紫色系', '色/紫色系/薄紫'];
  assert.deepEqual(toggleCategoryPath(selected, '色'), ['動物']);
  assert.deepEqual(toggleCategoryPath(selected, '色/紫色系'), ['動物', '色']);
  // 名前の前半が同じだけの別カテゴリは巻き込まない
  assert.deepEqual(toggleCategoryPath(['色', '色系'], '色'), ['色系']);
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
  // 空欄は「消す」ではなく「変更なし」。入力し忘れで既にある訳が消えないように
  const kept = renameCategory(base, { from: '動物', to: '生き物', en: '', ko: 'x' });
  assert.equal(kept.dataset.translations['生き物'].en, 'Animal', '空欄では既存の英語名を残す');
  assert.equal(kept.dataset.translations['生き物'].ko, 'x');
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

test('merge: grandchildren follow the child kept on the target side, not the source prefix', () => {
  const base: CategoryDataset = {
    header: HEADER,
    records: [row('0001', 'A,A/子,A/子/孫'), row('0002', 'B,B/子')],
    translations: {
      A: { en: 'Alpha', ko: '알파' },
      'A/子': { en: 'Alpha/Child', ko: '알파/자식' },
      'A/子/孫': { en: 'Alpha/Child/Grandchild', ko: '알파/자식/손자' },
      B: { en: 'Beta', ko: '베타' },
      'B/子': { en: 'Beta/Kid', ko: '베타/꼬마' },
    },
    colors: {},
  };
  const change = mergeCategory(base, { from: 'A', into: 'B' });
  assert.equal(categoriesOf(change.dataset.records, '0001'), 'B,B/子,B/子/孫');
  assert.deepEqual(change.dataset.translations['B/子'], { en: 'Beta/Kid', ko: '베타/꼬마' }, 'kept');
  assert.deepEqual(change.dataset.translations['B/子/孫'], { en: 'Beta/Kid/Grandchild', ko: '베타/꼬마/손자' });
  assert.doesNotThrow(() => assertTranslationHierarchy(change.dataset.translations));
});

test('assertTranslationHierarchy rejects a child whose parent is missing or whose prefix differs', () => {
  assert.throws(() => assertTranslationHierarchy({ 'A/子': { en: 'Alpha/Child', ko: '알파/자식' } }), /親「A」がありません/);
  assert.throws(
    () => assertTranslationHierarchy({ A: { en: 'Alpha', ko: '알파' }, 'A/子': { en: 'Beta/Child', ko: '알파/자식' } }),
    /「Alpha\/」で始まっていません/,
  );
  assert.doesNotThrow(() => assertTranslationHierarchy(dataset().translations));
});

test('merge: 未対訳の統合先でも、統合元の訳を捨てない', () => {
  // 統合先の項目が存在するだけで丸ごと飛ばすと、訳のあるカテゴリを未対訳へ
  // 統合したときにその訳が黙って消える
  const base: CategoryDataset = {
    ...dataset(),
    records: [...dataset().records, row('0007', '生物,生物/うま')],
    translations: {
      ...dataset().translations,
      '生物': { en: null, ko: null },
      '生物/うま': { en: null, ko: null },
    },
  };

  const change = mergeCategory(base, { from: '動物', into: '生物' });
  assert.deepEqual(change.dataset.translations['生物/うま'], { en: '生物/Horse', ko: '生物/말' });
  // 統合先そのものの名前は引き継がない（「動物」の訳は「生物」の訳ではない）
  assert.deepEqual(change.dataset.translations['生物'], { en: null, ko: null });
});

test('merge: refuses parent/child pairs, identical paths, protected and untranslated targets', () => {
  const base = dataset();
  assert.throws(() => mergeCategory(base, { from: '動物/うま', into: '動物' }), /親子関係/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '動物/うま' }), /親子関係/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '動物' }), /同じ/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: 'ワールド' }), /自動で扱う/);
  assert.throws(() => mergeCategory(base, { from: '動物', into: '未翻訳' }), /対訳表にありません/);
});

test('recolor: 最上位カテゴリに、既に使われている色だけを付け替えられる', () => {
  const change = recolorCategory(dataset(), { path: '動物', color: '#222222' });
  assert.equal(change.dataset.colors['動物'], '#222222');
  assert.equal(change.changedRows, 0, '行のカテゴリは変わらない');
  // 元の色を使っていた他のカテゴリは巻き込まない
  assert.equal(change.dataset.colors['乗り物'], '#222222');
  assert.equal(change.dataset.colors['空箱'], '#333333');
  assert.match(change.message, /Recolor category 動物 to #222222/);
});

test('recolor: 子階層・未登録の色・同じ色・保護カテゴリは拒む', () => {
  const base = dataset();
  const refuses = (request: { path: unknown; color: unknown }, pattern: RegExp) => {
    assert.throws(() => recolorCategory(base, request), (error: unknown) => {
      assert.ok(error instanceof CategoryOperationError);
      assert.match(error.message, pattern);
      return true;
    });
  };
  refuses({ path: '動物/うま', color: '#222222' }, /最上位/);
  refuses({ path: '動物', color: '#abcdef' }, /既に使われている色/);
  refuses({ path: '動物', color: '#111111' }, /同じ色/);
  refuses({ path: 'ワールド', color: '#222222' }, /アプリ/);
  refuses({ path: '無いカテゴリ', color: '#222222' }, /存在しません/);
  assert.deepEqual(base.colors, dataset().colors, '拒んだときは元のまま');
});

test('listCategoryColors: 使っている色を、使用カテゴリつきでまとめる', () => {
  const listed = listCategoryColors({ ...dataset(), colors: { a: '#111111', b: '#111111', c: '#222222' } });
  assert.deepEqual(
    listed.sort((x, y) => x.color.localeCompare(y.color)),
    [{ color: '#111111', usedBy: ['a', 'b'] }, { color: '#222222', usedBy: ['c'] }],
  );
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

/*
 * 新規作成の初期色は、そのデータセットに登録済みの色（`recolorCategory` が選ばせる
 * 集合）の中から選ぶ。`getCategoryColor` の後ろ 2 段（キーワード表・ハッシュ）には
 * どのカテゴリも使っていない色が残っていて、そのまま採るとパレットが 1 色増える。
 * 付け替えは「既に使われている色の中から」に絞ってあるので、新規作成だけが外へ
 * 出られる状態になっていた（例: `機械: #43a047` を踏む「機械仕掛け」）。
 *
 * どの色になるかは固定しない。管理画面の「色を変える」で登録済みの色はいつでも
 * 書き換わるので、色を書き写すとその操作のたびに落ちる（PR #554）。
 */
test('create: 新しい最上位の初期色は、そのデータセットの登録済みパレットから選ぶ', () => {
  const base = dataset();
  const palette = new Set(Object.values(base.colors));
  // キーワード表を踏む名前・ハッシュへ落ちる名前を、どちらも通す
  for (const path of ['機械仕掛け', 'ドラゴン', '道具', '未定義0']) {
    const change = createCategory(base, { path, en: 'X', ko: 'X' });
    assert.ok(
      palette.has(change.dataset.colors[path]),
      `${path} → ${change.dataset.colors[path]} は登録済みパレットの外`,
    );
  }

  // まとめて作った親階層も同じ規則で色を持つ（`植物` はキーワード表に載っている）
  const branch = createCategory(base, {
    path: '植物/木',
    en: 'Tree',
    ko: '나무',
    ancestors: [{ path: '植物', en: 'Plant', ko: '식물' }],
  });
  assert.ok(
    palette.has(branch.dataset.colors['植物']),
    `植物 → ${branch.dataset.colors['植物']} は登録済みパレットの外`,
  );

  // 実データの色を積んだ場合。報告そのままの再現
  const live: CategoryDataset = { ...base, colors: { ...(categoryColors as Record<string, string>) } };
  const registered = new Set(Object.values(live.colors));
  const onLive = createCategory(live, { path: '機械仕掛け', en: 'Clockwork', ko: '태엽' });
  assert.ok(
    registered.has(onLive.dataset.colors['機械仕掛け']),
    `機械仕掛け → ${onLive.dataset.colors['機械仕掛け']} は登録済みパレットの外`,
  );

  // 寄せる先が無いデータセットでは、これまでどおり候補をそのまま採る
  const empty = createCategory({ ...base, colors: {} }, { path: '機械仕掛け', en: 'X', ko: 'X' });
  assert.equal(empty.dataset.colors['機械仕掛け'], getCategoryColor('機械仕掛け'));
});

test('create: パレットへ寄せるときは、いちばん近い色を選ぶ', () => {
  // パレット外の色の多くは登録済みの色とほぼ同じで（`機械: #43a047` は実描画で
  // `#4caf50` と ΔE 0.8）、寄せても意図した色相のまま残る。ハッシュで振り直すと
  // その意図ごと捨てることになる。ここは自前の色見本なので値を書いてよい
  const base: CategoryDataset = { ...dataset(), colors: { 赤: '#c62828', 緑: '#2e7d32', 青: '#1565c0' } };
  const initial = (path: string) => createCategory(base, { path, en: 'X', ko: 'X' }).dataset.colors[path];
  assert.equal(initial('機械仕掛け'), base.colors['緑'], 'キーワード表の緑 #43a047');
  assert.equal(initial('ドラゴン'), base.colors['赤'], 'キーワード表の赤 #d32f2f');
  assert.equal(initial('人類学'), base.colors['青'], 'キーワード表の青 #2196f3');
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
  assert.throws(
    () => createCategory(base, { path: '植物/木', en: 'Tree', ko: '나무' }),
    /親カテゴリ「植物」がまだ存在しません。まとめて作るには/,
  );
  // 親が未対訳でも作れる。訳の無い階層は日本語のまま前に付く（段ごとのフォールバック）
  const underUntranslated = createCategory(base, { path: '未翻訳/子', en: 'Child', ko: '아이' });
  assert.deepEqual(underUntranslated.dataset.translations['未翻訳/子'], { en: '未翻訳/Child', ko: '未翻訳/아이' });
  // Prototype names are neither "existing" nor special once stored as own properties.
  const prototypeName = createCategory(base, { path: 'constructor', en: 'Constructor', ko: '생성자' });
  assert.equal(Object.hasOwn(prototypeName.dataset.translations, 'constructor'), true);
  assert.throws(() => createCategory(base, { path: '__proto__', en: 'x', ko: 'x' }), /__proto__/);
  assert.throws(() => createCategory(base, { path: '動物/__proto__', en: 'x', ko: 'x' }), /__proto__/);
});

test('表記だけが違うカテゴリは、作成でも改名でも増やせない', () => {
  // 一覧に並ぶと見分けが付かず、どちらに付けたのか誰にも分からなくなる。
  // 完全一致ではないので、これまでの「既に存在します」では止まらない
  const base: CategoryDataset = {
    ...dataset(),
    translations: { ...dataset().translations, 'Gear': { en: 'Gear', ko: '기어' } },
  };

  assert.throws(
    () => createCategory(base, { path: 'gear', en: 'Gear', ko: '기어' }),
    /「gear」は既存の「Gear」と大文字小文字や表記だけが違います/,
  );
  assert.throws(
    () => createCategory(base, {
      path: 'GEAR/x',
      en: 'X',
      ko: 'X',
      ancestors: [{ path: 'GEAR', en: 'Gear', ko: '기어' }],
    }),
    /「GEAR」は既存の「Gear」と/,
    '作る親階層も同じ規則で見る',
  );
  assert.throws(
    () => renameCategory(base, { from: '乗り物', to: 'GEAR', en: 'Gear', ko: '기어' }),
    /「GEAR」は既存の「Gear」と/,
    '改名でも同じ状態には持っていけない',
  );

  // 表記そのものを直す改名は、自分自身と衝突させない
  const fixCase = renameCategory(base, { from: 'Gear', to: 'gear', en: 'Gear', ko: '기어' });
  assert.deepEqual(fixCase.dataset.translations['gear'], { en: 'Gear', ko: '기어' });
  assert.equal(Object.hasOwn(fixCase.dataset.translations, 'Gear'), false);
});

test('改名は宛先だけでなく、書き換わる子孫の新しいパスも見る', () => {
  // 宛先が空いていても、子の側で並んでしまえば同じこと
  const base: CategoryDataset = {
    ...dataset(),
    translations: {
      ...dataset().translations,
      'Gear': { en: 'Gear', ko: '기어' },
      'Gear/bolt': { en: 'Gear/Bolt', ko: '기어/볼트' },
      'Zed/BOLT': { en: 'Zed/Bolt', ko: '제드/볼트' },
    },
  };

  assert.throws(
    () => renameCategory(base, { from: 'Gear', to: 'Zed', en: 'Zed', ko: '제드' }),
    /「Zed\/bolt」は既存の「Zed\/BOLT」と/,
  );

  // 宛先は「自分自身の付け替え先」として既に一覧に入っている。二重に渡すと同じ指摘が並ぶ
  const clash: CategoryDataset = {
    ...dataset(),
    translations: { ...dataset().translations, 'Gear': { en: 'G', ko: 'g' }, 'zed': { en: 'Z', ko: 'z' } },
  };
  assert.throws(
    () => renameCategory(clash, { from: 'Gear', to: 'Zed', en: 'Zed', ko: '제드' }),
    (error: unknown) =>
      error instanceof CategoryOperationError &&
      error.message.match(/「Zed」は既存の「zed」/g)?.length === 1,
    '同じ宛先の指摘は 1 回だけ',
  );
});

test('表記ゆれを止めるときは、まとめる手段も伝える', () => {
  // 「別の名前に」だけでは、既にあるペアを片付けたい人の行き場が無い
  const base: CategoryDataset = {
    ...dataset(),
    translations: { ...dataset().translations, 'Gear': { en: 'Gear', ko: '기어' } },
  };
  assert.throws(
    () => createCategory(base, { path: 'gear', en: 'Gear', ko: '기어' }),
    /「統合」を使ってください/,
  );
});

test('create: builds a whole new branch when no level exists yet', () => {
  // Akyo 側の画面は未登録カテゴリを書けないので、ここで枝ごと作れないと
  // 「新しい親/新しい子」を足す手段がどこにも無くなる
  const change = createCategory(dataset(), {
    path: '植物/木',
    en: 'Tree',
    ko: '나무',
    ancestors: [{ path: '植物', en: 'Plant', ko: '식물' }],
  });

  assert.deepEqual(change.dataset.translations['植物'], { en: 'Plant', ko: '식물' });
  assert.deepEqual(change.dataset.translations['植物/木'], { en: 'Plant/Tree', ko: '식물/나무' });
  assert.match(change.dataset.colors['植物'], /^#[0-9a-f]{6}$/, '新しい最上位は色を固定する');
  assert.equal(change.changedRows, 0, 'Akyo の行は変えない');
  assert.match(change.message, /Create categories 植物, 植物\/木/);
});

test('create: builds three levels at once and keeps the ancestors editable on their own', () => {
  const change = createCategory(dataset(), {
    path: '道具/工具/ハンマー',
    en: 'Hammer',
    ko: '망치',
    ancestors: [
      { path: '道具', en: 'Tool', ko: '도구' },
      { path: '道具/工具', en: 'Hardware', ko: '공구' },
    ],
  });

  assert.deepEqual(change.dataset.translations['道具/工具'], { en: 'Tool/Hardware', ko: '도구/공구' });
  assert.deepEqual(change.dataset.translations['道具/工具/ハンマー'], {
    en: 'Tool/Hardware/Hammer',
    ko: '도구/공구/망치',
  });
});

test('create: refuses to guess a missing level, ignores levels that already exist', () => {
  const base = dataset();

  assert.throws(
    () => createCategory(base, {
      path: '道具/工具/ハンマー',
      en: 'Hammer',
      ko: '망치',
      ancestors: [{ path: '道具', en: 'Tool', ko: '도구' }],
    }),
    /親カテゴリ「道具\/工具」がまだ存在しません/,
    '足りない階層を勝手に埋めない',
  );
  // 画面の一覧が古いと、サーバー側では既にある階層を送ってしまう。捨てるだけにして、
  // 画面上に満たす手段が無いフォームを作らない。既存の対訳は書き換えない
  const stale = createCategory(base, {
    path: '動物/ねこ',
    en: 'Cat',
    ko: '고양이',
    ancestors: [{ path: '動物', en: 'Beast', ko: '짐승' }],
  });
  assert.deepEqual(stale.dataset.translations['動物'], { en: 'Animal', ko: '동물' });
  assert.deepEqual(stale.dataset.translations['動物/ねこ'], { en: 'Animal/Cat', ko: '동물/고양이' });
  assert.deepEqual(stale.createdPaths, ['動物/ねこ']);

  assert.throws(
    () => createCategory(base, {
      path: '植物/木',
      en: 'Tree',
      ko: '나무',
      ancestors: [
        { path: '植物', en: 'Plant', ko: '식물' },
        { path: '乗り物', en: 'Vehicle', ko: '탈것' },
      ],
    }),
    /「乗り物」はこのカテゴリの親階層ではありません/,
    '親ですらないものは要求の作りが違う',
  );
  assert.throws(
    () => createCategory(base, {
      path: '植物/木',
      en: 'Tree',
      ko: '나무',
      ancestors: [{ path: '植物', en: 'Plant/Extra', ko: '식물' }],
    }),
    /「\/」は使えません/,
  );
  assert.throws(
    () => createCategory(base, { path: '植物/木', en: 'Tree', ko: '나무', ancestors: 'x' }),
    /形式が不正/,
  );
});

test('summarizeCategories: counts rows per path including descendants, merges CSV tokens and table keys', () => {
  const summary = summarizeCategories(dataset());
  const byPath = new Map(summary.map((entry) => [entry.path, entry]));
  assert.equal(byPath.get('動物')?.count, 3);
  assert.equal(byPath.get('動物/うま')?.count, 2);
  assert.equal(byPath.get('動物/うま/ポニー')?.count, 1);
  // 未対訳でも、EN/KO のデータに実際に出る名前（日本語のまま）を添える
  assert.deepEqual(byPath.get('未翻訳'), {
    path: '未翻訳', en: null, ko: null, enDisplay: '未翻訳', koDisplay: '未翻訳', count: 1,
  });
  assert.deepEqual(byPath.get('空箱'), {
    path: '空箱', en: 'Empty Box', ko: '빈 상자', enDisplay: 'Empty Box', koDisplay: '빈 상자', count: 0,
  });
  // 訳された親の下の未対訳な子は、親の訳＋日本語の葉になる
  assert.equal(byPath.get('動物/うま/ポニー')?.enDisplay, 'Animal/Horse/Pony');
});

test('serialization sorts keys and ends with a newline', () => {
  assert.equal(serializeCategoryColors({ 'b': '#000000', 'a': '#ffffff' }), '{\n  "a": "#ffffff",\n  "b": "#000000"\n}\n');
  const text = serializeCategoryTranslations({ '動物/うま': { en: 'Animal/Horse', ko: '동물/말' }, '動物': { en: 'Animal', ko: '동물' } });
  assert.deepEqual(Object.keys(JSON.parse(text)), ['動物', '動物/うま']);
});
