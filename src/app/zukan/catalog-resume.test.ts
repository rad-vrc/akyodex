import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_RESUME_MIN_INTERVAL_MS,
  shouldResumeCatalogLoad,
} from "./catalog-resume";

const STALLED = {
  datasetComplete: false,
  stalled: true,
  msSinceLastResume: Number.POSITIVE_INFINITY,
};

test("bfcache から戻って取得が止まっていれば取り直す", () => {
  assert.equal(
    shouldResumeCatalogLoad({ type: "pageshow", persisted: true }, STALLED),
    true,
  );
});

test("通常の読み込みの pageshow では取り直さない", () => {
  // persisted が false の pageshow は初回表示でも発火する。
  // そちらは初回の取得が走るので、二重に投げない
  assert.equal(
    shouldResumeCatalogLoad({ type: "pageshow", persisted: false }, STALLED),
    false,
  );
});

test("タブが表示に戻って取得が止まっていれば取り直す", () => {
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "visibilitychange", visibilityState: "visible" },
      STALLED,
    ),
    true,
  );
});

test("タブが隠れる側では取り直さない", () => {
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "visibilitychange", visibilityState: "hidden" },
      STALLED,
    ),
    false,
  );
});

test("取得が進行中なら復帰しても取り直さない", () => {
  // 正常に遅いだけの取得を、復帰のたびに潰して振り出しに戻さないため
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "pageshow", persisted: true },
      { ...STALLED, stalled: false },
    ),
    false,
  );
});

test("完全版が適用済みなら取り直さない", () => {
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "visibilitychange", visibilityState: "visible" },
      { ...STALLED, datasetComplete: true },
    ),
    false,
  );
});

test("直前に取り直したばかりなら間隔が空くまで投げ直さない", () => {
  // 取得元が落ちている間にタブを行き来されると、復帰のたびに失敗を送ってしまう
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "visibilitychange", visibilityState: "visible" },
      { ...STALLED, msSinceLastResume: CATALOG_RESUME_MIN_INTERVAL_MS - 1 },
    ),
    false,
  );
  assert.equal(
    shouldResumeCatalogLoad(
      { type: "visibilitychange", visibilityState: "visible" },
      { ...STALLED, msSinceLastResume: CATALOG_RESUME_MIN_INTERVAL_MS },
    ),
    true,
  );
});
