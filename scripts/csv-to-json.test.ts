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
  "BoothURL",
];

interface UrlFields {
  sourceUrl?: string;
  avatarUrl: string;
  boothUrl?: string;
}

interface PreviousState {
  url: string;
  boothUrl: string;
  urlUpdatedAt?: string;
}

interface TestableModule {
  parseCsvToAkyoData: (csvText: string) => Array<{
    id: string;
    entryType?: "avatar" | "world";
    sourceUrl?: string;
    avatarUrl: string;
    urlUpdatedAt?: string;
  }>;
  getEntryUrl: (entry: UrlFields) => string;
  resolveUrlUpdatedAt: (current: UrlFields, previous: PreviousState | undefined, now: string) => string | undefined;
  stampUrlUpdatedAt: (
    rows: Array<{ id: string; urlUpdatedAt?: string } & UrlFields>,
    previousById: Map<string, PreviousState>,
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
    )}\nexport { parseCsvToAkyoData, getEntryUrl, resolveUrlUpdatedAt, stampUrlUpdatedAt };\n`;
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
        "",
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
        "",
      ],
    ]);

    const parsed = mod.parseCsvToAkyoData(csv);
    assert.equal(parsed[0]?.entryType, "world");
    assert.equal(parsed[1]?.entryType, "avatar");
  });
});

test("getEntryUrl は VRChat の表記ゆれを正規化し、元URLが無い Booth 専用エントリは BoothURL で比べる", async () => {
  await withTestableModule((mod) => {
    const canonical = "https://vrchat.com/home/avatar/avtr_a";
    assert.equal(mod.getEntryUrl({ avatarUrl: canonical }), canonical);
    assert.equal(mod.getEntryUrl({ avatarUrl: ` ${canonical} ` }), canonical, "前後の空白");
    assert.equal(mod.getEntryUrl({ avatarUrl: `${canonical}/info` }), canonical, "タブの付いたコピー URL");
    assert.equal(mod.getEntryUrl({ sourceUrl: canonical, avatarUrl: "https://vrchat.com/home/avatar/avtr_old" }), canonical, "sourceUrl 優先");
    assert.equal(mod.getEntryUrl({ avatarUrl: "", boothUrl: "https://x.booth.pm/items/1" }), "https://x.booth.pm/items/1");
    assert.equal(mod.getEntryUrl({ avatarUrl: canonical, boothUrl: "https://x.booth.pm/items/1" }), canonical, "元URLがあれば Booth は見ない");
    assert.equal(mod.getEntryUrl({ avatarUrl: "" }), "");
  });
});

test("resolveUrlUpdatedAt は新規登録・URL 変更・後から付いた BoothURL を now にし、それ以外は前回の刻印を引き継ぐ", async () => {
  await withTestableModule((mod) => {
    const now = "2026-09-18T00:00:00.000Z";
    const before = "2026-09-01T00:00:00.000Z";
    const url = "https://vrchat.com/home/avatar/avtr_a";
    const booth = "https://x.booth.pm/items/1";
    // 新規登録
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, undefined, now), now);
    // URL が変わった
    assert.equal(
      mod.resolveUrlUpdatedAt({ avatarUrl: "https://vrchat.com/home/avatar/avtr_b" }, { url, boothUrl: "", urlUpdatedAt: before }, now),
      now,
    );
    // 変わっていない → 前回の刻印
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, { url, boothUrl: "", urlUpdatedAt: before }, now), before);
    // 変わっていない・前回も刻印なし（導入前からの行）→ 付けない
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url }, { url, boothUrl: "" }, now), undefined);
    // sourceUrl があればそちらで比べる。前後の空白や /info は差とみなさない
    assert.equal(mod.resolveUrlUpdatedAt({ sourceUrl: ` ${url}/info `, avatarUrl: "" }, { url, boothUrl: "" }, now), undefined);
    // Booth 専用エントリは BoothURL の差し替えで最新になる
    assert.equal(
      mod.resolveUrlUpdatedAt({ avatarUrl: "", boothUrl: "https://x.booth.pm/items/2" }, { url: booth, boothUrl: booth, urlUpdatedAt: before }, now),
      now,
    );

    // 後から BoothURL が付いた（Booth に出た）→ 最新
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: booth }, { url, boothUrl: "" }, now), now);
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: ` ${booth} ` }, { url, boothUrl: "", urlUpdatedAt: before }, now), now);
    // 最初から付いていて変わらない → 引き継ぐ
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: booth }, { url, boothUrl: booth, urlUpdatedAt: before }, now), before);
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: booth }, { url, boothUrl: booth }, now), undefined);
    // 元URLのある行で BoothURL を差し替えただけ・外しただけ → 対象外
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: "https://x.booth.pm/items/2" }, { url, boothUrl: booth, urlUpdatedAt: before }, now), before);
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: "" }, { url, boothUrl: booth, urlUpdatedAt: before }, now), before);
    // 空白だけの BoothURL は「付いた」とみなさない
    assert.equal(mod.resolveUrlUpdatedAt({ avatarUrl: url, boothUrl: "   " }, { url, boothUrl: "" }, now), undefined);
  });
});

test("stampUrlUpdatedAt は日本語の行に刻印し、ID → 刻印の対応を返す", async () => {
  await withTestableModule((mod) => {
    const now = "2026-09-18T00:00:00.000Z";
    const rows = [
      { id: "0001", avatarUrl: "https://vrchat.com/home/avatar/avtr_same" },
      { id: "0002", avatarUrl: "https://vrchat.com/home/avatar/avtr_new-version", urlUpdatedAt: "stale" },
      { id: "0003", avatarUrl: "https://vrchat.com/home/avatar/avtr_added" },
      // URL は変わっていないのに、上流から紛れ込んだ刻印を持っている行
      { id: "0004", avatarUrl: "https://vrchat.com/home/avatar/avtr_quiet", urlUpdatedAt: "stale-garbage" },
      // 後から BoothURL が付いた行
      { id: "0005", avatarUrl: "https://vrchat.com/home/avatar/avtr_booth", boothUrl: "https://x.booth.pm/items/5" },
    ];
    const previous = new Map<string, PreviousState>([
      ["0001", { url: "https://vrchat.com/home/avatar/avtr_same", boothUrl: "" }],
      ["0002", { url: "https://vrchat.com/home/avatar/avtr_old-version", boothUrl: "", urlUpdatedAt: "2026-09-01T00:00:00.000Z" }],
      ["0004", { url: "https://vrchat.com/home/avatar/avtr_quiet", boothUrl: "" }],
      ["0005", { url: "https://vrchat.com/home/avatar/avtr_booth", boothUrl: "" }],
    ]);
    const stamps = mod.stampUrlUpdatedAt(rows, previous, now);
    assert.deepEqual([...stamps.entries()], [["0002", now], ["0003", now], ["0005", now]]);
    assert.equal("urlUpdatedAt" in rows[0]!, false, "変更の無い導入前の行には付けない");
    assert.equal(rows[1]!.urlUpdatedAt, now, "CSV 側に紛れ込んだ値ではなく判定結果で上書きする");
    assert.equal(rows[2]!.urlUpdatedAt, now);
    assert.equal("urlUpdatedAt" in rows[3]!, false, "前回に刻印が無い行の紛れ込んだ値は消す");
    assert.equal(rows[4]!.urlUpdatedAt, now, "後から Booth に出た行");
  });
});

// 実際にスクリプトを走らせ、前回 JSON との比較から EN / KO への写しまで通す
test("csv-to-json stamps urlUpdatedAt from the previous JA JSON and copies it to other languages", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "csv-to-json-"));
  const dataDir = path.join(cwd, "data");
  await mkdir(dataDir);
  try {
    const LANGS = ["ja", "en", "ko"] as const;
    const rows = (lang: string, url0002: string, booth0003 = "") =>
      buildCsv([
        HEADER,
        ["0001", `nick-${lang}`, "Avatar One", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_one", "", "Avatar", "", ""],
        ["0002", `nick-${lang}`, "Avatar Two", "動物", "", "Author", url0002, "", "Avatar", "", ""],
        ["0003", `nick-${lang}`, "Avatar Three", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_three", "", "Avatar", "", booth0003],
      ]);
    const writeCsvs = async (make: (lang: string) => string) => {
      for (const lang of LANGS) {
        await writeFile(path.join(dataDir, `akyo-data-${lang}.csv`), make(lang));
      }
    };
    const run = (expectedStatus = 0) => {
      const result = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH], { cwd, encoding: "utf8" });
      assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`);
      // 警告は console.warn（stderr）に出るので両方をまとめて返す
      return `${result.stdout}\n${result.stderr}`;
    };
    const readJson = async (lang: string) =>
      JSON.parse(await readFile(path.join(dataDir, `akyo-data-${lang}.json`), "utf8")) as {
        data: Array<{ id: string; urlUpdatedAt?: string }>;
      };
    const stampsOf = async (lang: string) =>
      Object.fromEntries((await readJson(lang)).data.map((row) => [row.id, row.urlUpdatedAt]));

    // 1 回目: 前回 JSON が無い → 何も刻まない（導入時に全件が最新になるのを防ぐ）
    await writeCsvs((lang) => rows(lang, "https://vrchat.com/home/avatar/avtr_two-v1"));
    const firstLog = run();
    assert.match(firstLog, /No previous JSON/);
    assert.deepEqual(await stampsOf("ja"), { "0001": undefined, "0002": undefined, "0003": undefined });

    // 2 回目: 変更なし → 引き続き刻まない
    run();
    assert.deepEqual(await stampsOf("ja"), { "0001": undefined, "0002": undefined, "0003": undefined });

    // 3 回目: 0002 の URL を差し替え、0004 を追加 → その 2 行だけ刻まれ、EN / KO にも同じ値が写る
    const withChanges = (lang: string) =>
      rows(lang, "https://vrchat.com/home/avatar/avtr_two-v2").replace(
        /\n$/,
        `\n${buildCsv([["0004", `nick-${lang}`, "Avatar Four", "動物", "", "Author", "https://vrchat.com/home/avatar/avtr_four", "", "Avatar", "", ""]])}`,
      );
    await writeCsvs(withChanges);
    const thirdLog = run();
    assert.match(thirdLog, /urlUpdatedAt: 2 row\(s\) stamped/);
    const ja = await stampsOf("ja");
    assert.deepEqual(Object.keys(ja).filter((id) => ja[id]), ["0002", "0004"]);
    const stamp = ja["0002"]!;
    assert.ok(!Number.isNaN(Date.parse(stamp)), "ISO 8601 で刻まれる");
    for (const lang of ["en", "ko"]) {
      assert.deepEqual(await stampsOf(lang), ja, `${lang} には日本語と同じ刻印が写る`);
    }

    // 4 回目: 変更なし → 3 回目の刻印をそのまま引き継ぐ
    run();
    assert.deepEqual(await stampsOf("ja"), ja);
    assert.deepEqual(await stampsOf("ko"), ja);

    // 5 回目: 0003 に BoothURL が後から付いた → 0003 だけ新しく刻まれる（他は引き継ぎ）
    const withBooth = (lang: string) =>
      withChanges(lang).replace(
        `"https://vrchat.com/home/avatar/avtr_three","","Avatar","",""`,
        `"https://vrchat.com/home/avatar/avtr_three","","Avatar","","https://x.booth.pm/items/3"`,
      );
    await writeCsvs(withBooth);
    const fifthLog = run();
    assert.match(fifthLog, /urlUpdatedAt: 1 row\(s\) stamped/);
    const afterBooth = await stampsOf("ja");
    assert.ok(afterBooth["0003"], "Booth に出た行が刻まれる");
    assert.notEqual(afterBooth["0003"], stamp);
    assert.equal(afterBooth["0002"], stamp, "他の行は引き継ぎ");
    assert.equal(afterBooth["0001"], undefined);
    assert.deepEqual(await stampsOf("en"), afterBooth);

    // 6 回目: 同じ BoothURL のまま → 引き継ぐ
    run();
    assert.deepEqual(await stampsOf("ja"), afterBooth);

    // 7 回目: 前回 JSON が壊れている → 書かずに止まる（刻印の履歴を消さない）
    const jaJsonPath = path.join(dataDir, "akyo-data-ja.json");
    const goodJaJson = await readFile(jaJsonPath, "utf8");
    const enJsonBefore = await readFile(path.join(dataDir, "akyo-data-en.json"), "utf8");
    await writeFile(jaJsonPath, '{"data":"oops"}');
    const seventhLog = run(1);
    assert.match(seventhLog, /Refusing to write JSON without urlUpdatedAt history/);
    assert.equal(await readFile(jaJsonPath, "utf8"), '{"data":"oops"}', "壊れた前回 JSON は上書きしない");
    assert.equal(await readFile(path.join(dataDir, "akyo-data-en.json"), "utf8"), enJsonBefore, "他言語も書かない");

    // 8 回目: 前回 JSON が空（0 行）→ 全件を新規登録扱いにせず、刻まない
    await writeFile(jaJsonPath, '{"data":[]}');
    const eighthLog = run();
    assert.match(eighthLog, /has 0 rows/);
    assert.deepEqual(await stampsOf("ja"), { "0001": undefined, "0002": undefined, "0003": undefined, "0004": undefined });

    // 復旧: 正しい前回 JSON に戻せば刻印は引き継がれる
    await writeFile(jaJsonPath, goodJaJson);
    run();
    assert.deepEqual(await stampsOf("ja"), afterBooth);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
