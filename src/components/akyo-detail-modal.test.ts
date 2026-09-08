import assert from "node:assert/strict";
import test from "node:test";

import { AkyoDetailModal } from "@/components/akyo-detail-modal";
import type { AkyoData } from "@/types/akyo";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AVATAR_URL = "https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc";

const avatar: AkyoData = {
  id: "0001",
  entryType: "avatar",
  appearance: "",
  nickname: "オリジンAkyo",
  avatarName: "Akyo origin",
  category: "動物,動物/うま",
  comment: "はじまりのAkyo。",
  author: "ugai",
  attribute: "動物",
  notes: "",
  creator: "ugai",
  sourceUrl: AVATAR_URL,
  avatarUrl: AVATAR_URL,
  boothUrl: "https://booth.pm/ja/items/123",
};

function render(akyo: AkyoData = avatar) {
  return renderToStaticMarkup(
    createElement(AkyoDetailModal, { akyo, isOpen: true, onClose: () => {} }),
  );
}

/** 見出しごとに、開始タグと中身を取り出す */
function headings(markup: string): { open: string; inner: string }[] {
  return [...markup.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/g)].map((m) => ({
    open: m[1],
    inner: m[2],
  }));
}

/**
 * アイコン付きの見出しは flex で上下中央に揃える。
 *
 * インライン配置のままだと SVG の下辺がテキストのベースラインに乗るので、
 * どれだけずれるかが書体のベースライン位置任せになる。実測（M PLUS 2 を読み込み、
 * 900px 幅）では、あきょうちしきの 🎁 がテキストの中心より 3.31px 下、他の見出しも
 * 2.36px 下にいた。flex にすると書体に関係なく 0px になる。
 */
test("アイコン付きの見出しは flex で中央に揃え、余白は gap で取る", () => {
  const withIcon = headings(render()).filter((h) => h.inner.includes("<svg"));
  assert.ok(withIcon.length >= 4, `アイコン付きの見出しが ${withIcon.length} 個しかない`);

  for (const heading of withIcon) {
    assert.match(heading.open, /class="[^"]*\bflex\b[^"]*"/, `flex が無い: ${heading.open}`);
    assert.match(heading.open, /class="[^"]*\bitems-center\b[^"]*"/, `items-center が無い: ${heading.open}`);
    assert.match(heading.open, /class="[^"]*\bgap-\d\b[^"]*"/, `gap が無い: ${heading.open}`);
    // gap と mr が両方効くと、見出しごとに余白が変わる
    assert.doesNotMatch(heading.inner, /<svg[^>]*\bmr-\d/, `svg に mr が残っている: ${heading.inner.slice(0, 120)}`);
    // flex アイテムは既定で縮む。w-4 を持っていても、幅が足りなければ潰れる
    // （shrink-0 なしで実測すると、枠 180px でアイコンが 0.34px まで縮んだ）
    assert.match(heading.inner, /<svg[^>]*\bshrink-0\b/, `svg に shrink-0 が無い: ${heading.inner.slice(0, 120)}`);
  }
});

test("あきょうちしきの見出しにアイコンと本文が両方ある", () => {
  const markup = render();
  const bonus = headings(markup).find((h) => h.inner.includes("あきょうちしき"));
  assert.ok(bonus, "あきょうちしきの見出しが無い");
  assert.match(bonus.inner, /<svg/);
  assert.match(bonus.open, /class="[^"]*flex items-center gap-2[^"]*"/);
});
