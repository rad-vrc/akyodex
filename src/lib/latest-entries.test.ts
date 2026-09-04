import assert from "node:assert/strict";
import test from "node:test";

import { getInternalIdNumber, selectLatestEntries } from "./akyo-entry";

test("getInternalIdNumber は 4 桁の内部 ID を数値にする", () => {
  assert.equal(getInternalIdNumber({ id: "0042" }), 42);
  assert.equal(getInternalIdNumber({ id: "1200" }), 1200);
});

test("getInternalIdNumber は数値にならない ID を 0 に落とす", () => {
  assert.equal(getInternalIdNumber({ id: "" }), 0);
  assert.equal(getInternalIdNumber({ id: "abc" }), 0);
});

test("selectLatestEntries は表示連番ではなく内部 ID の降順で並べる", () => {
  // ワールドは displaySerial が独立採番なので、表示連番で並べると
  // 内部 ID の新しさとは無関係な順序になる。最新 N 件はそれを見てはいけない。
  const entries = [
    { id: "0100", displaySerial: "0100" }, // アバター
    { id: "0300", displaySerial: "0002" }, // ワールド 2 番目（登録は最新）
    { id: "0200", displaySerial: "0001" }, // ワールド 1 番目
  ];

  assert.deepEqual(
    selectLatestEntries(entries, 3).map((entry) => entry.id),
    ["0300", "0200", "0100"],
  );
});

test("selectLatestEntries は count 件で打ち切る", () => {
  const entries = Array.from({ length: 150 }, (_, index) => ({
    id: String(index + 1).padStart(4, "0"),
  }));

  const latest = selectLatestEntries(entries, 100);

  assert.equal(latest.length, 100);
  assert.equal(latest[0].id, "0150");
  assert.equal(latest[99].id, "0051");
});

test("selectLatestEntries は入力配列を書き換えない", () => {
  const entries = [{ id: "0001" }, { id: "0003" }, { id: "0002" }];

  selectLatestEntries(entries, 2);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["0001", "0003", "0002"],
  );
});
