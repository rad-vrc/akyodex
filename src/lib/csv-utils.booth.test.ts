import assert from "node:assert/strict";
import test from "node:test";

import { parseCsvToAkyoData } from "./csv-utils";

// 管理画面の CRUD・バッチ・保存後の読み直しはこの経路を通る。ここで ensureBoothCategories を
// 外すと、登録・更新で Booth が付かず、古い子階層も残る（Muse の変異 M7）
test("parseCsvToAkyoData adds Booth for rows with a BoothURL and drops the retired child", () => {
  const csv = [
    '"ID","Nickname","AvatarName","Category","Comment","Author","AvatarURL","SourceURL","EntryType","DisplaySerial","BoothURL"',
    '"0001","N1","A1","動物,Booth,Booth/アバター","","x","https://vrchat.com/home/avatar/avtr_1","","avatar","0001","https://booth.pm/ja/items/1"',
    '"0002","N2","A2","動物","","x","https://vrchat.com/home/avatar/avtr_2","","avatar","0002","https://booth.pm/ja/items/2"',
    '"0003","N3","A3","動物","","x","https://vrchat.com/home/avatar/avtr_3","","avatar","0003",""',
  ].join("\n");

  const parsed = parseCsvToAkyoData(csv);
  assert.deepEqual(
    parsed.map((row) => [row.id, row.category]),
    [
      ["0001", "動物,Booth"],
      ["0002", "動物,Booth"],
      ["0003", "動物"],
    ],
  );
  assert.equal(parsed[0]?.attribute, "動物,Booth", "旧フィールドも同じ値");
});
