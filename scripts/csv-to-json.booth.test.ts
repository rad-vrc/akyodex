import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const SCRIPT_PATH = path.resolve("scripts/csv-to-json.ts");

// CSV → JSON 生成で ensureBoothCategories を外すと、子階層が R2 に残り続ける（Muse の変異 M11）
test("csv-to-json adds Booth for BoothURL rows and drops the retired Booth child", async () => {
  const tempModulePath = path.resolve("scripts", `.csv-to-json.testable-${randomUUID()}.ts`);
  try {
    const originalSource = await readFile(SCRIPT_PATH, "utf8");
    await writeFile(
      tempModulePath,
      `${originalSource.replace(/\/\/ Run if executed directly[\s\S]*$/, "")}\nexport { parseCsvToAkyoData };\n`,
      "utf8",
    );
    const { parseCsvToAkyoData } = (await import(pathToFileURL(tempModulePath).href)) as {
      parseCsvToAkyoData: (csv: string) => Array<{ id: string; category: string }>;
    };
    const csv = [
      '"ID","Nickname","AvatarName","Category","Comment","Author","AvatarURL","SourceURL","EntryType","DisplaySerial","BoothURL"',
      '"0001","N1","A1","動物,Booth,Booth/アバター","","x","https://vrchat.com/home/avatar/avtr_1","","Avatar","","https://booth.pm/ja/items/1"',
      '"0002","N2","A2","動物/きつね","","x","https://vrchat.com/home/avatar/avtr_2","","Avatar","","https://booth.pm/ja/items/2"',
      '"0003","N3","A3","動物","","x","https://vrchat.com/home/avatar/avtr_3","","Avatar","",""',
    ].join("\n");
    assert.deepEqual(
      parseCsvToAkyoData(csv).map((row) => [row.id, row.category]),
      [
        ["0001", "動物,Booth"],
        ["0002", "動物,動物/きつね,Booth"], // 親の補完の後に Booth が付く
        ["0003", "動物"],
      ],
    );
  } finally {
    await rm(tempModulePath, { force: true });
  }
});
