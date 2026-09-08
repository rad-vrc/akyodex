/**
 * platforms.json をもとに、日本語 CSV の Category 列へ対応機種カテゴリを付ける。
 *
 *   全件（判定できたもの）  対応機種, 対応機種/PC
 *   android の実ビルドあり   対応機種/Quest(Android)
 *   ios の実ビルドあり       対応機種/iOS
 *
 * impostor（VRChat の自動生成）は platforms.json の時点で除外済み。
 * 判定できなかった個体には何も付けない。
 *
 * EN/KO CSV と JSON は、このあと既存の生成スクリプトで作り直す。
 *
 * 使い方
 *   node apply-platform-categories.mjs <akyo-data-ja.csv> <platforms.json> [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";

const [csvPath, platformsPath, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");

const ROOT = "対応機種";
const PC = "対応機種/PC";
const QUEST = "対応機種/Quest(Android)";
const IOS = "対応機種/iOS";

/** RFC4180 相当。引用符内の改行と "" を扱う。 */
function parseCsv(text) {
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
const serialize = (rows, eol) =>
  rows.map((row) => row.map((f) => `"${String(f).replaceAll('"', '""')}"`).join(",")).join(eol) + eol;

const original = await readFile(csvPath, "utf8");
// 引用符の中に CRLF があると全体を CRLF と誤判定して全行が差分になるので、
// ヘッダ行の終端だけを見る。
const firstBreak = original.indexOf("\n");
const eol = firstBreak > 0 && original[firstBreak - 1] === "\r" ? "\r\n" : "\n";
const rows = parseCsv(original);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const platforms = JSON.parse(await readFile(platformsPath, "utf8"));

let touched = 0, quest = 0, ios = 0, skipped = 0;
const skippedIds = [];

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row[idx.ID]) continue;

  const vrcId = `${row[idx.AvatarURL] ?? ""} ${row[idx.SourceURL] ?? ""}`.match(
    /(avtr|wrld)_[0-9a-fA-F-]{36}/,
  )?.[0];
  const record = vrcId ? platforms[vrcId] : null;

  // 判定できなかったものには何も付けない（非公開・削除済みなど）
  if (!record || record.status !== 200) {
    skipped += 1;
    skippedIds.push(row[idx.ID]);
    continue;
  }

  const current = (row[idx.Category] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const add = [];
  const push = (name) => { if (!current.includes(name) && !add.includes(name)) add.push(name); };

  push(ROOT);
  push(PC); // PC を持たない個体は 0 件だったので全件に付ける
  if ((record.platforms ?? []).includes("android")) { push(QUEST); quest += 1; }
  if ((record.platforms ?? []).includes("ios")) { push(IOS); ios += 1; }

  if (add.length === 0) continue;
  row[idx.Category] = [...current, ...add].join(",");
  touched += 1;
}

console.log(`付与した行 ${touched}（Quest ${quest} / iOS ${ios}）`);
console.log(`何も付けなかった行 ${skipped}${skippedIds.length ? `（${skippedIds.join(", ")}）` : ""}`);

if (dryRun) {
  console.log("\n--dry-run のため書き込みませんでした。");
} else {
  await writeFile(csvPath, serialize(rows, eol), "utf8");
  console.log(`\n書き込み: ${csvPath}`);
}
