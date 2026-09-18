import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const SCRIPT_PATH = path.resolve("scripts/csv-to-json.ts");
const TSX_CLI = path.resolve("node_modules/tsx/dist/cli.mjs");

function buildCsv(rows: string[][]): string {
  return `${rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n")}\n`;
}

const HEADER = [
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
];

interface TestableModule {
  parseCsvToAkyoData: (csvText: string) => Array<{
    id: string;
    entryType?: "avatar" | "world";
    sourceUrl?: string;
    avatarUrl: string;
    urlUpdatedAt?: string;
  }>;
  resolveUrlUpdatedAt: (
    current: { sourceUrl?: string; avatarUrl: string },
    previous: { url: string; urlUpdatedAt?: string } | undefined,
    now: string,
  ) => string | undefined;
  stampUrlUpdatedAt: (
    rows: Array<{ id: string; sourceUrl?: string; avatarUrl: string; urlUpdatedAt?: string }>,
    previousById: Map<string, { url: string; urlUpdatedAt?: string }>,
    now: string,
  ) => Map<string, string>;
}

/**
 * スクリプトは読み込むと即実行するので、実行部を切り落として関数だけ export した
 * 一時コピーを import する。
 */
async function withTestableModule<T>(run: (mod: TestableModule) => Promise<T> | T): Promise<T> {
  const tempModulePath = path.resolve("scripts", `.csv-to-json.testable-${randomUUID()}.ts`);
  try {
    const originalSource = await readFile(SCRIPT_PATH, "utf8");
    const patchedSource = `${originalSource.replace(
      /\/\/ Run if executed directly[\s\S]*$/,
      "",
    )}\nexport { parseCsvToAkyoData, resolveUrlUpdatedAt, stampUrlUpdatedAt };\n`;
    await writeFile(tempModulePath, patchedSource, "utf8");
    const imported = (await import(pathToFileURL(tempModulePath).href)) as TestableModule;
    return await run(imported);
  } finally {
    await rm(tempModulePath, { force: true });
  }
}

test("parseCsvToAkyoData normalizes EntryType before validating it", async () => {
  await withTestableModule((mod) => {
    const csv = buildCsv([
      HEADER,
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

    const parsed = mod.parseCsvToAkyoData(csv);
    assert.equal(parsed[0]?.entryType, "world");
    assert.equal(parsed[1]?.entryType, "avatar");
  });
});

test("resolveUrlUpdatedAt は新規登録と URL 変更だけを now にし、それ以外は前回の刻印を引き継ぐ", async () => {
  await withTestableModule((mod) => {
    const now = "2026-09-18T00:00:00.000Z";
    const before = "2026-09-01T00:00:00.000Z";
    const url = "https://vrchat.com/home/avatar/avtr_a";
    // 新規登録
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, undefined, now), now);
    // URL が変わった
    assert.equal(
      mod.resolveUrlUpdatedAt({ avatarUrl: "https://vrchat.com/home/avatar/avtr_b" }, { url, urlUpdatedAt: before }, now),
      now,
    );
    // 変わっていない → 前回の刻印
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, { url, urlUpdatedAt: before }, now), before);
    // 変わっていない・前回も刻印なし（導入前からの行）→ 付けない
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, { url }, now), undefined);
    // sourceUrl があればそちらで比べる。前後の空白は無視
    assert.equal(mod.resolveUrlUpdatedAt({ sourceUrl: ` ${url} `, avatarUrl: "" }, { url }, now), undefined);
  });
});

test("stampUrlUpdatedAt は日本語の行に刻印し、ID → 刻印の対応を返す", async () => {
  await withTestableModule((mod) => {
    const now = "2026-09-18T00:00:00.000Z";
    const rows = [
      { id: "0001", avatarUrl: "https://vrchat.com/home/avatar/avtr_same" },
      { id: "0002", avatarUrl: "https://vrchat.com/home/avatar/avtr_new-version", urlUpdatedAt: "stale" },
      { id: "0003", avatarUrl: "https://vrchat.com/home/avatar/avtr_added" },
    ];
    const previous = new Map([
      ["0001", { url: "https://vrchat.com/home/avatar/avtr_same" }],
      ["0002", { url: "https://vrchat.com/home/avatar/avtr_old-version", urlUpdatedAt: "2026-09-01T00:00:00.000Z" }],
    ]);
    const stamps = mod.stampUrlUpdatedAt(rows, previous, now);
    assert.deepEqual([...stamps.entries()], [["0002", now], ["0003", now]]);
    assert.equal("urlUpdatedAt" in rows[0]!, false, "変更の無い導入前の行には付けない");
    assert.equal(rows[1]!.urlUpdatedAt, now, "CSV 側に紛れ込んだ値ではなく判定結果で上書きする");
    assert.equal(rows[2]!.urlUpdatedAt, now);
  });
});

// 実際にスクリプトを走らせ、前回 JSON との比較から EN への写しまで通す
test("csv-to-json stamps urlUpdatedAt from the previous JA JSON and copies it to other languages", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "csv-to-json-"));
  const dataDir = path.join(cwd, "data");
  await mkdir(dataDir);
  try {
    const rows = (lang: string, url0002: string) =>
      buildCsv([
        HEADER,
        ["0001", `nick-${lang}`, "Avatar One", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_one", "", "Avatar", ""],
        ["0002", `nick-${lang}`, "Avatar Two", "動物", "", "Author", url0002, "", "Avatar", ""],
        ["0003", `nick-${lang}`, "Avatar Three", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_three", "", "Avatar", ""],
      ]);
    const run = () => {
      const result = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH], { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      // 警告は console.warn（stderr）に出るので両方をまとめて返す
      return `${result.stdout}\n${result.stderr}`;
    };
    const readJson = async (lang: string) =>
      JSON.parse(await readFile(path.join(dataDir, `akyo-data-${lang}.json`), "utf8")) as {
        data: Array<{ id: string; urlUpdatedAt?: string }>;
      };

    // 1 回目: 前回 JSON が無い → 何も刻まない（導入時に全件が最新になるのを防ぐ）
    await writeFile(path.join(dataDir, "akyo-data-ja.csv"), rows("ja", "https://vrchat.com/home/avatar/avtr_two-v1"));
    await writeFile(path.join(dataDir, "akyo-data-en.csv"), rows("en", "https://vrchat.com/home/avatar/avtr_two-v1"));
    const firstLog = run();
    assert.match(firstLog, /No previous JSON/);
    const first = await readJson("ja");
    assert.deepEqual(first.data.map((row) => row.urlUpdatedAt), [undefined, undefined, undefined]);

    // 2 回目: 変更なし → 引き続き刻まない
    run();
    const second = await readJson("ja");
    assert.deepEqual(second.data.map((row) => row.urlUpdatedAt), [undefined, undefined, undefined]);

    // 3 回目: 0002 の URL を差し替え、0004 を追加 → その 2 行だけ刻まれ、EN にも同じ値が写る
    const withChanges = (lang: string) =>
      rows(lang, "https://vrchat.com/home/avatar/avtr_two-v2").replace(
        /\n$/,
        `\n${buildCsv([["0004", `nick-${lang}`, "Avatar Four", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_four", "", "Avatar", ""]])}`,
      );
    await writeFile(path.join(dataDir, "akyo-data-ja.csv"), withChanges("ja"));
    await writeFile(path.join(dataDir, "akyo-data-en.csv"), withChanges("en"));
    const thirdLog = run();
    assert.match(thirdLog, /urlUpdatedAt: 2 row\(s\) stamped/);
    const third = await readJson("ja");
    const thirdEn = await readJson("en");
    const stampedIds = third.data.filter((row) => row.urlUpdatedAt).map((row) => row.id);
    assert.deepEqual(stampedIds, ["0002", "0004"]);
    const stamp = third.data.find((row) => row.id === "0002")!.urlUpdatedAt!;
    assert.ok(!Number.isNaN(Date.parse(stamp)), "ISO 8601 で刻まれる");
    assert.equal(thirdEn.data.find((row) => row.id === "0002")?.urlUpdatedAt, stamp);
    assert.equal(thirdEn.data.find((row) => row.id === "0004")?.urlUpdatedAt, third.data.find((row) => row.id === "0004")?.urlUpdatedAt);
    assert.equal(thirdEn.data.find((row) => row.id === "0001")?.urlUpdatedAt, undefined);

    // 4 回目: 変更なし → 3 回目の刻印をそのまま引き継ぐ
    run();
    const fourth = await readJson("ja");
    assert.equal(fourth.data.find((row) => row.id === "0002")?.urlUpdatedAt, stamp);
    assert.equal(fourth.data.find((row) => row.id === "0001")?.urlUpdatedAt, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
