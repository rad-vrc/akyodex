import assert from "node:assert/strict";
import test from "node:test";

import { EditModal } from "@/components/admin/edit-modal";
import type { AkyoData } from "@/types/akyo";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AVATAR_URL = "https://vrchat.com/home/avatar/avtr_12345678-1234-1234-1234-123456789abc";
const WORLD_URL = "https://vrchat.com/home/world/wrld_12345678-1234-1234-1234-123456789abc";

const avatar: AkyoData = {
  id: "0042",
  entryType: "avatar",
  appearance: "",
  nickname: "テストAkyo",
  avatarName: "Akyo origin",
  category: "動物",
  comment: "",
  author: "ugai",
  attribute: "動物",
  notes: "",
  creator: "ugai",
  sourceUrl: AVATAR_URL,
  avatarUrl: AVATAR_URL,
};

const world: AkyoData = {
  ...avatar,
  id: "0300",
  entryType: "world",
  displaySerial: "0002",
  nickname: "テストワールド",
  avatarName: "",
  category: "ワールド",
  attribute: "ワールド",
  sourceUrl: WORLD_URL,
  avatarUrl: WORLD_URL,
};

function render(akyo: AkyoData | null, isOpen = true) {
  return renderToStaticMarkup(
    createElement(EditModal, {
      isOpen,
      onClose: () => {},
      akyo,
      attributes: ["動物", "ワールド"],
      onSuccess: () => {},
    }),
  );
}

test("閉じているときは何も描画しない", () => {
  assert.equal(render(avatar, false), "");
  assert.equal(render(null, true), "");
});

test("ダイアログとしての役割・名前・説明が付いている（WCAG 4.1.2 / APG Modal Dialog）", () => {
  const markup = render(avatar);

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);

  const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledBy, "aria-labelledby が無い");
  assert.match(markup, new RegExp(`id="${labelledBy}"`), "aria-labelledby の参照先が無い");

  const describedBy = markup.match(/role="dialog"[^>]*aria-describedby="([^"]+)"/)?.[1];
  assert.ok(describedBy, "aria-describedby が無い");
  assert.match(markup, new RegExp(`id="${describedBy}"`), "aria-describedby の参照先が無い");

  // 閉じるボタンはアイコンだけなので、名前を属性で与える
  assert.match(markup, /<button[^>]*aria-label="閉じる"/);
});

test("全ての入力欄に対応する label がある（WCAG 1.3.1 / 3.3.2）", () => {
  for (const akyo of [avatar, world]) {
    const markup = render(akyo);
    const ids = [...markup.matchAll(/<(?:input|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 6, `入力欄が少なすぎる: ${ids.length}`);
    for (const id of ids) {
      assert.match(markup, new RegExp(`<label[^>]*for="${id}"`), `label for="${id}" が無い`);
    }
  }
});

test("関連する項目は fieldset/legend でまとめる（WCAG 1.3.1）", () => {
  const markup = render(avatar);
  const legends = markup.match(/<legend/g) ?? [];
  assert.ok(legends.length >= 4, `legend が ${legends.length} 個しかない`);
  assert.equal((markup.match(/<fieldset/g) ?? []).length, legends.length);
});

test("重複確認の結果は aria-live 領域で通知する（WCAG 4.1.3）", () => {
  const markup = render(avatar);
  const statuses = markup.match(/role="status"[^>]*aria-live="polite"/g) ?? [];
  assert.ok(statuses.length >= 2, `status 領域が ${statuses.length} 個しかない`);
});

test("背景は modal-backdrop クラスを使う（Tailwind v4 に無い bg-opacity を使わない）", () => {
  const markup = render(avatar);
  assert.match(markup, /class="modal-backdrop /);
  assert.doesNotMatch(markup, /bg-opacity/);
});

test("ヘッダーに ID と種別を出す", () => {
  assert.match(render(avatar), /#0042/);
  assert.match(render(avatar), />アバター</);
  assert.match(render(world), /#0300/);
  assert.match(render(world), />ワールド</);
  assert.match(render(world), /World0002/);
});

test("アバターのときだけアバター名欄と URL 取得ボタンを出す", () => {
  const avatarMarkup = render(avatar);
  assert.match(avatarMarkup, /id="edit-avatar-name"/);
  assert.match(avatarMarkup, /URLからアバター名を取得/);
  assert.match(avatarMarkup, /URLから画像を取得/);
  assert.match(avatarMarkup, /for="edit-nickname"[^>]*>ニックネーム</);

  const worldMarkup = render(world);
  assert.doesNotMatch(worldMarkup, /id="edit-avatar-name"/);
  assert.doesNotMatch(worldMarkup, /URLからアバター名を取得/);
  assert.doesNotMatch(worldMarkup, /URLから画像を取得/);
  assert.match(worldMarkup, /for="edit-nickname"[^>]*>ワールド名</);
});

test("現在の画像を表示し、更新ボタンはフッターから form 属性でフォームに結びつく", () => {
  const markup = render(avatar);
  assert.match(markup, /現在の画像/);
  assert.match(markup, /<img[^>]*alt="[^"]*現在の画像"/);

  const formId = markup.match(/<form[^>]*\sid="([^"]+)"/)?.[1];
  assert.ok(formId, "form に id が無い");
  assert.match(markup, new RegExp(`<button[^>]*type="submit"[^>]*form="${formId}"`));
});
