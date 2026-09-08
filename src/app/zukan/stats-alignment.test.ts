import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./zukan-client.tsx", import.meta.url), "utf8");

/**
 * ヘッダーの統計（総数 / 表示中 / お気に入り）は、ラベル（dt）と中身（dd）で
 * 文字の大きさが違い、狭い画面では中身だけが複数行に折り返す。
 *
 * items-center だと 1 行のラベルが折り返した中身の上下中央に置かれる。本番の
 * /zukan を 360px 幅で実測すると、ラベルのベースラインが中身の 1 行目より
 * 8.5px 下にいた（1280px では -0.6px）。items-baseline なら 0px になり、
 * ラベルは常に 1 行目の文字に並ぶ。
 */
test("統計のラベルと中身はベースラインで揃える（折り返しても 1 行目に並ぶ）", () => {
  const pills = source.match(/rounded-2xl sm:rounded-full flex items-\w+ gap-1 sm:gap-2/g) ?? [];
  assert.equal(pills.length, 3, `統計の枠が ${pills.length} 個しかない`);
  for (const pill of pills) {
    assert.match(pill, /flex items-baseline gap-1/, `中央揃えのまま: ${pill}`);
  }
});

/**
 * お気に入りの枠は、中身（dd）自身がハートと数字を持つ flex 行になっている。
 * ここが items-center だと、外側の枠から見たこの dd のベースラインは、ベースラインを
 * 持たない置換要素（SVG）の下辺から作られるので、ラベルが数字ではなくハートに揃う。
 * 本番の /zukan で実測すると、外側だけ baseline にしても 1280px で 3.00px、
 * 360px で 1.45px 残った。中も baseline にすると両方 0px になり、ハートと数字の
 * ずれも 1.00px → -0.40px（1280px）に縮む。
 */
test("お気に入りの中身も、ハートではなく数字のベースラインで揃える", () => {
  const dd = source.match(/<dd className="min-w-\[5ch\][^"]*"/);
  assert.ok(dd, "お気に入りの dd が見つからない");
  assert.match(dd[0], /flex items-baseline gap-1/, `中央揃えのまま: ${dd[0]}`);
});
