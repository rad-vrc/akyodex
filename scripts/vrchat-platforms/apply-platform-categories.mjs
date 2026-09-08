/**
 * platforms.json をもとに、日本語 CSV の Category 列へ対応機種カテゴリを付ける。
 *
 *   判定できた行   対応機種, 対応機種/PC
 *   android あり   対応機種/Quest(Android)
 *   ios あり       対応機種/iOS
 *
 * impostor（VRChat の自動生成）は platforms.json の時点で除外済み。
 *
 * 判定できた行では、対応機種配下を今回の判定で**置き換える**。追加だけにすると、
 * 作者が Quest 版を取り下げたあとに取り直しても古いタグが残ってしまう。
 * 判定できなかった行（非公開・削除済み、および HTTP 200 でも実ビルドが空だった
 * もの）は既存のカテゴリに触れない。取得失敗を「対応終了」と読み替えて消すのは
 * 危険なため。判定できたかどうかは record.mjs の realPlatformsOf が決める。
 *
 * EN/KO CSV と JSON は、このあと既存の生成スクリプトで作り直す。
 *
 * 使い方
 *   node apply-platform-categories.mjs <akyo-data-ja.csv> <platforms.json> [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { realPlatformsOf } from "./record.mjs";

export const ROOT = "対応機種";
export const PC = "対応機種/PC";
export const QUEST = "対応機種/Quest(Android)";
export const IOS = "対応機種/iOS";

/** RFC4180 相当。引用符内の改行と "" を扱う。 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 元の CSV は全フィールドを引用符で囲んでいるので、その形で書き戻す。 */
export const serializeCsv = (rows, eol) =>
  rows.map((row) => row.map((f) => `"${String(f).replaceAll('"', '""')}"`).join(",")).join(eol) + eol;

/**
 * 対応機種配下だけを今回の判定で置き換える。ほかのカテゴリは順序ごと保つ。
 *
 * @param {string} categoryField CSV の Category 列
 * @param {string[]|null} platforms 実ビルドのプラットフォーム。判定できなければ null
 * @returns {string} 新しい Category 列
 */
export function mergePlatformCategories(categoryField, platforms) {
  const current = String(categoryField ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // 判定できなかった行は触らない（取得失敗＝対応終了ではない）
  if (platforms === null) return current.join(",");

  const kept = current.filter((c) => c !== ROOT && !c.startsWith(`${ROOT}/`));
  const added = [ROOT, PC]; // PC を持たない個体は 0 件だったので判定できた行には必ず付ける
  if (platforms.includes("android")) added.push(QUEST);
  if (platforms.includes("ios")) added.push(IOS);
  return [...kept, ...added].join(",");
}

/** 行から VRChat の ID を取り出す */
export const vrchatIdOf = (row, idx) =>
  `${row[idx.AvatarURL] ?? ""} ${row[idx.SourceURL] ?? ""}`.match(
    /(avtr|wrld)_[0-9a-fA-F-]{36}/,
  )?.[0] ?? null;

async function main() {
  const [csvPath, platformsPath, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");

  if (!csvPath || !platformsPath) {
    console.error("使い方: node apply-platform-categories.mjs <akyo-data-ja.csv> <platforms.json> [--dry-run]");
    process.exitCode = 2;
    return;
  }

  const original = await readFile(csvPath, "utf8");
  // 引用符の中に CRLF があると全体を CRLF と誤判定して全行が差分になるので、
  // ヘッダ行の終端だけを見る。
  const firstBreak = original.indexOf("\n");
  const eol = firstBreak > 0 && original[firstBreak - 1] === "\r" ? "\r\n" : "\n";

  const rows = parseCsv(original);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const platforms = JSON.parse(await readFile(platformsPath, "utf8"));

  let changed = 0, quest = 0, ios = 0, removed = 0;
  const untouched = [];
  const empty200 = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[idx.ID]) continue;

    const id = vrchatIdOf(row, idx);
    const record = id ? platforms[id] : null;
    const judged = realPlatformsOf(record);

    if (judged === null) {
      untouched.push(row[idx.ID]);
      // 200 なのに実ビルドが空。非公開ではなく、取得がうまくいっていない疑い。
      if (record?.status === 200) empty200.push(row[idx.ID]);
      continue;
    }

    const before = row[idx.Category] ?? "";
    const after = mergePlatformCategories(before, judged);
    if (before !== after) {
      const had = before.split(",").filter((c) => c.startsWith(ROOT)).length;
      const has = after.split(",").filter((c) => c.startsWith(ROOT)).length;
      if (had > has) removed += had - has;
      row[idx.Category] = after;
      changed += 1;
    }
    if (judged.includes("android")) quest += 1;
    if (judged.includes("ios")) ios += 1;
  }

  console.log(`書き換えた行 ${changed}（判定: Quest ${quest} / iOS ${ios}）`);
  if (removed) console.log(`対応終了により外したタグ ${removed} 個`);
  console.log(`判定できず触らなかった行 ${untouched.length}${untouched.length ? `（${untouched.join(", ")}）` : ""}`);
  if (empty200.length) {
    console.warn(
      `  うち ${empty200.length} 件は HTTP 200 なのに実ビルドが空でした（${empty200.join(", ")}）。\n` +
        "  取得の途中でクッキーが切れた可能性があります。--refresh で取り直してください。",
    );
  }

  if (dryRun) {
    console.log("\n--dry-run のため書き込みませんでした。");
    return;
  }
  await writeFile(csvPath, serializeCsv(rows, eol), "utf8");
  console.log(`\n書き込み: ${csvPath}`);
}

// テストから import したときは実行しない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
