import assert from "node:assert/strict";
import test from "node:test";

import { SearchBar } from "@/components/search-bar";
import { FilterPanel } from "@/components/filter-panel";
import { SortControls } from "@/components/sort-controls";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("SearchBar uses native disabled and busy states while the full catalog loads", () => {
  const markup = renderToStaticMarkup(
    createElement(SearchBar, {
      onSearch: () => {},
      disabled: true,
    }),
  );

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /<input[^>]*disabled=""/);
});

test("FilterPanel disables its complete control group while the full catalog loads", () => {
  const markup = renderToStaticMarkup(
    createElement(FilterPanel, {
      attributes: ["動物"],
      creators: ["author"],
      disabled: true,
    }),
  );

  assert.match(markup, /<fieldset[^>]*disabled=""[^>]*aria-busy="true"/);
  assert.equal(
    markup.match(/max-h-52[^\"]*overflow-hidden/g)?.length,
    2,
  );
  assert.doesNotMatch(markup, /data-loading-scroll-region/);
});

// 並び替え系はモバイルの折りたたみフィルタ外へ独立した（sort-controls.tsx）。
// FilterPanel から分離されたこと自体もこのアサーションが守る。
test("SortControls renders outside FilterPanel and disables while loading", () => {
  const sortMarkup = renderToStaticMarkup(
    createElement(SortControls, {
      onSortToggle: () => {},
      onLatestClick: () => {},
      onRandomClick: () => {},
      onFavoritesClick: () => {},
      favoritesOnly: false,
      sortAscending: true,
      latestMode: false,
      randomMode: false,
      disabled: true,
    }),
  );
  assert.match(sortMarkup, /<fieldset[^>]*disabled=""[^>]*aria-busy="true"/);
  assert.match(sortMarkup, /昇順/);
  assert.match(sortMarkup, /最新100件/);
  assert.match(sortMarkup, /ランダム/);

  const panelMarkup = renderToStaticMarkup(
    createElement(FilterPanel, {
      attributes: ["動物"],
      creators: ["author"],
    }),
  );
  assert.doesNotMatch(panelMarkup, /昇順|降順|最新100件|ランダム/);
});

// 最新100件は昇順降順とランダムの間に置く（並び順そのものが要件）。
test("SortControls places the latest-100 toggle between sort order and random", () => {
  const markup = renderToStaticMarkup(
    createElement(SortControls, {
      onSortToggle: () => {},
      onLatestClick: () => {},
      onRandomClick: () => {},
      onFavoritesClick: () => {},
      favoritesOnly: false,
      sortAscending: true,
      latestMode: true,
      randomMode: false,
    }),
  );

  assert.ok(
    markup.indexOf("昇順") < markup.indexOf("最新100件") &&
      markup.indexOf("最新100件") < markup.indexOf("ランダム"),
  );
  // 有効時は aria-pressed と配色の両方で状態が分かる
  assert.match(markup, /aria-pressed="true"[^>]*bg-purple-200/);
});
