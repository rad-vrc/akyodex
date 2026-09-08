import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./edit-tab.tsx", import.meta.url), "utf8");

test("edit tab table headers declare scope for each column", () => {
  const scopedHeaders = source.match(/<th scope="col"/g) ?? [];
  assert.equal(scopedHeaders.length, 6);
});

test("edit tab search input is programmatically labeled", () => {
  assert.match(source, /<label htmlFor="edit-tab-search"/);
  assert.match(source, /id="edit-tab-search"/);
});

/**
 * 表は w-full なので、はみ出す分は各列が縮んで吸収する。操作列を縮ませると
 * 「編集」「削除」が 2 行に割れ、行の高さが揃わなくなる（582px 幅で実測すると、
 * 折り返す前は 48px・折り返さないと 28px）。この列だけ折り返さない。
 */
test("操作列は見出しもセルも折り返さない", () => {
  assert.match(source, /<th scope="col" className="whitespace-nowrap[^"]*">\s*操作/);
  assert.match(source, /<td className="whitespace-nowrap px-4 py-3 text-center">/);
});
