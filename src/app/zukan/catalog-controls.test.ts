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
      onRandomClick: () => {},
      onFavoritesClick: () => {},
      favoritesOnly: false,
      sortAscending: true,
      randomMode: false,
      disabled: true,
    }),
  );
  assert.match(sortMarkup, /<fieldset[^>]*disabled=""[^>]*aria-busy="true"/);
  assert.match(sortMarkup, /昇順/);
  assert.match(sortMarkup, /ランダム/);

  const panelMarkup = renderToStaticMarkup(
    createElement(FilterPanel, {
      attributes: ["動物"],
      creators: ["author"],
    }),
  );
  assert.doesNotMatch(panelMarkup, /昇順|降順|ランダム/);
});
