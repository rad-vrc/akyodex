import assert from "node:assert/strict";
import test from "node:test";

import {
  compareByLatest,
  getInternalIdNumber,
  getUrlUpdatedTime,
  selectLatestEntries,
} from "./akyo-entry";

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

test("selectLatestEntries は最新100件を維持したまま昇順と降順を切り替える", () => {
  const entries = Array.from({ length: 150 }, (_, index) => ({
    id: String(index + 1).padStart(4, "0"),
    displaySerial: String(150 - index).padStart(4, "0"),
  }));
  const ascending = selectLatestEntries(entries, 100, true);
  const descending = selectLatestEntries(entries, 100, false);

  assert.deepEqual(ascending, [...descending].reverse());
  assert.equal(ascending.length, 100);
  assert.equal(ascending[0].id, "0051");
  assert.equal(ascending[99].id, "0150");
  assert.equal(entries[0].id, "0001");
  assert.equal(entries[149].id, "0150");
});

test("selectLatestEntries は対象種別内で選んだ最新件数を昇順にする", () => {
  const entries = [
    { id: "0001", entryType: "world", displaySerial: "0001" },
    { id: "0100", entryType: "world", displaySerial: "0002" },
    { id: "0200", entryType: "avatar", displaySerial: "0198" },
    { id: "0300", entryType: "world", displaySerial: "0003" },
  ];
  assert.deepEqual(
    selectLatestEntries(entries.filter((entry) => entry.entryType === "world"), 2, true)
      .map((entry) => entry.id),
    ["0100", "0300"],
  );
});

test("selectLatestEntries は入力配列を書き換えない", () => {
  const entries = [{ id: "0001" }, { id: "0003" }, { id: "0002" }];

  selectLatestEntries(entries, 2);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["0001", "0003", "0002"],
  );
});

test("getUrlUpdatedTime は ISO 8601 をミリ秒にし、無効・未設定は null", () => {
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "2026-09-18T00:00:00.000Z" }), Date.UTC(2026, 8, 18));
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: " 2026-09-18T00:00:00.000Z " }), Date.UTC(2026, 8, 18));
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "" }), null);
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "not a date" }), null);
  assert.equal(getUrlUpdatedTime({}), null);
  // Date.parse が通してしまう年だけ・数値文字列は認めない（手編集の混入が最古の刻印になるのを防ぐ）
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "2026" }), null);
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "1726617600000" }), null);
  assert.equal(getUrlUpdatedTime({ urlUpdatedAt: "2026-09-18" }), null);
});

// 比較関数が非対称だと、入力順によっては刻印の無い行が刻印のある行より前に出る
test("compareByLatest は反対称で、どの 2 行を入れ替えても符号が反転する", () => {
  const entries = [
    { id: "0010" },
    { id: "0500" },
    { id: "0020", urlUpdatedAt: "2026-09-10T00:00:00.000Z" },
    { id: "0030", urlUpdatedAt: "2026-09-18T00:00:00.000Z" },
    { id: "0400", urlUpdatedAt: "2026-09-18T00:00:00.000Z" },
    { id: "0001", urlUpdatedAt: "garbage" },
  ];
  for (const a of entries) {
    for (const b of entries) {
      const forward = Math.sign(compareByLatest(a, b));
      const backward = Math.sign(compareByLatest(b, a));
      // 0 と -0 を同一視するため和で見る
      assert.equal(forward + backward, 0, `${a.id} vs ${b.id}`);
      if (a === b) assert.equal(forward, 0);
    }
  }
  // 入力順を裏返しても同じ結果になる（順序が入力順に依存しない）
  const sorted = [...entries].sort(compareByLatest).map((entry) => entry.id);
  const reversed = [...entries].reverse().sort(compareByLatest).map((entry) => entry.id);
  assert.deepEqual(sorted, reversed);
  assert.deepEqual(sorted, ["0400", "0030", "0020", "0500", "0010", "0001"]);
});

// URL を差し替えた（アバターを上げ直した）エントリは、番号を変えずに最新扱いにする
test("selectLatestEntries は urlUpdatedAt を持つ行を内部 ID より優先し、時刻の新しい順に置く", () => {
  const entries = [
    { id: "0010" }, // 古い、URL 変更なし
    { id: "0500" }, // 一番新しい ID だが URL 変更なし
    { id: "0020", urlUpdatedAt: "2026-09-10T00:00:00.000Z" }, // 先に URL を差し替えた
    { id: "0030", urlUpdatedAt: "2026-09-18T00:00:00.000Z" }, // 後から URL を差し替えた
    { id: "0400", urlUpdatedAt: "2026-09-18T00:00:00.000Z" }, // 同時刻 → ID の降順
  ];

  assert.deepEqual(
    selectLatestEntries(entries, 5).map((entry) => entry.id),
    ["0400", "0030", "0020", "0500", "0010"],
  );
  // 件数で切っても、刻印のある行が先に残る
  assert.deepEqual(
    selectLatestEntries(entries, 3).map((entry) => entry.id),
    ["0400", "0030", "0020"],
  );
  // 昇順表示はその範囲を裏返すだけ
  assert.deepEqual(
    selectLatestEntries(entries, 3, true).map((entry) => entry.id),
    ["0020", "0030", "0400"],
  );
});

test("compareByLatest は無効な urlUpdatedAt を未設定と同じに扱う", () => {
  const entries = [
    { id: "0001", urlUpdatedAt: "garbage" },
    { id: "0002" },
    { id: "0003", urlUpdatedAt: "2026-01-01T00:00:00Z" },
  ];
  assert.deepEqual(
    [...entries].sort(compareByLatest).map((entry) => entry.id),
    ["0003", "0002", "0001"],
  );
});
