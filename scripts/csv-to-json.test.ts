import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const SCRIPT_PATH = path.resolve("scripts/csv-to-json.ts");

function buildCsv(rows: string[][]): string {
  return `${rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n")}\n`;
}

test("parseCsvToAkyoData normalizes EntryType before validating it", async () => {
  const tempModulePath = path.resolve(
    "scripts",
    `.csv-to-json.testable-${randomUUID()}.ts`,
  );

  try {
    const originalSource = await readFile(SCRIPT_PATH, "utf8");
    const patchedSource = `${originalSource.replace(
      /\/\/ Run if executed directly[\s\S]*$/,
      "",
    )}\nexport { parseCsvToAkyoData };\n`;
    await writeFile(tempModulePath, patchedSource, "utf8");

    const imported = (await import(pathToFileURL(tempModulePath).href)) as {
      parseCsvToAkyoData: (csvText: string) => Array<{
        entryType?: "avatar" | "world";
      }>;
    };

    const csv = buildCsv([
      [
        "ID",
        "Nickname",
        "AvatarName",
        "Category",
        "Comment",
        "Author",
        "AvatarURL",
        "SourceURL",
        "EntryType",
        "DisplaySerial",
      ],
      [
        "0812",
        "World Entry",
        "",
        "ワールド",
        "",
        "Author",
        "https://vrchat.com/home/world/wrld_example",
        "https://vrchat.com/home/world/wrld_example",
        " World ",
        "0067",
      ],
      [
        "0813",
        "Avatar Entry",
        "Avatar Name",
        "チョコミント類",
        "",
        "Author",
        "https://vrchat.com/home/avatar/avtr_example",
        "",
        "Avatar",
        "",
      ],
    ]);

    const parsed = imported.parseCsvToAkyoData(csv);
    assert.equal(parsed[0]?.entryType, "world");
    assert.equal(parsed[1]?.entryType, "avatar");
  } finally {
    await rm(tempModulePath, { force: true });
  }
});
