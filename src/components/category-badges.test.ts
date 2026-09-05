import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CategoryBadges } from './category-badges';

const textOf = (markup: string) => markup.replace(/<[^>]+>/g, '');

test('CategoryBadges: 親子の間と、グループ同士の間にテキストの区切りが残る', () => {
  const markup = renderToStaticMarkup(
    createElement(CategoryBadges, { categories: ['乗り物', '乗り物/陸上', '動物', '動物/うま', '動物/両生類', '次元'] }),
  );
  // 読み上げ・検索・コピーで正規トークン「動物/うま」が文字列として見つかる
  assert.equal(textOf(markup), '乗り物/陸上 動物/うま, 両生類 次元');
  assert.match(markup, /class="sr-only">\/</);
});

test('CategoryBadges: 子のない親は sr-only の区切りを持たず、単独チップになる', () => {
  const markup = renderToStaticMarkup(createElement(CategoryBadges, { categories: ['次元'] }));
  assert.equal(textOf(markup), '次元');
  assert.doesNotMatch(markup, /sr-only/);
  assert.doesNotMatch(markup, /category-group__children/);
});

test('CategoryBadges: カテゴリが無ければ何も描画しない', () => {
  assert.equal(renderToStaticMarkup(createElement(CategoryBadges, { categories: [] })), '');
});
