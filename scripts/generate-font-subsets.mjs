/**
 * Generate a self-hosted M PLUS 2 subset from the live catalog data + UI sources.
 *
 * The full variable font is ~4.2MB. This script keeps only the characters
 * the site can actually render — every name/author/category/comment across
 * the ja/en/ko catalogs, every non-ASCII character that appears in src/
 * (UI_TEXTS in i18n.ts, hardcoded JSX strings, aria-labels, error messages),
 * all kana, ASCII, and Japanese punctuation — and preserves the wght
 * variation axis, producing a single woff2 that serves every weight
 * (400/500/700/900...) from one file committed to src/fonts/.
 *
 * Characters that appear in future catalog updates but are missing from the
 * committed subset fall back to the system font stack (no tofu). The data
 * sync workflow re-runs this script so the subset follows the data.
 *
 * After subsetting, the output cmap is parsed and verified to contain every
 * requested character that exists in the source font; the manifest records
 * the covered set so scripts/font-subset-coverage.test.js can detect drift
 * (e.g. new UI text added without regenerating the subset).
 *
 * The source TTF is pinned to a google/fonts commit and verified by sha256.
 * License: SIL OFL 1.1 (see src/fonts/LICENSE-MPLUS2.txt).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "scripts", ".font-cache");
const outDir = path.join(rootDir, "src", "fonts");

const SOURCE_COMMIT = "84efd8ad78c3710ad14bd909e3bc407151885628";
const SOURCES = [
  {
    // M PLUS 2（2021年新設計）。旧M PLUS Rounded 1cはRegular〜Mediumの線が
    // 細く、Windowsの等倍小サイズ描画で本文がかすれて見えた（ドット欠け）。
    // M PLUS 2は細ウェイトでもストロークが痩せない設計で、この症状が出ない。
    // 可変フォントなのでwght軸ごとサブセットし、1ファイルで全ウェイトを配信する。
    dir: "mplus2",
    file: "MPLUS2[wght].ttf",
    sha256: "2e4f45c2391355fb03195da4854ffbe85fea49bfdff5cc51020238083af6b75c",
    out: "mplus2-variable.subset.woff2",
  },
];

const DATA_FILES = ["akyo-data-ja.json", "akyo-data-en.json", "akyo-data-ko.json"];
// comment/notes はおまけ情報本文にもサイト書体を適用するため収録する
const DATA_FIELDS = [
  "nickname",
  "avatarName",
  "author",
  "category",
  "displaySerial",
  "comment",
  "notes",
];

// Always-included ranges so the subset never depends on today's data alone:
// ASCII, hiragana + katakana (full blocks incl. marks and ー), CJK punctuation,
// and fullwidth forms used in Japanese UI text.
const STATIC_RANGES = [
  [0x0020, 0x007e],
  [0x3000, 0x303f],
  [0x3041, 0x309f],
  [0x30a0, 0x30ff],
  [0xff01, 0xff65],
];

// Korean text intentionally falls back to the system stack (subsetting Hangul
// would roughly double the file for a locale the system fonts already render
// well). Cover every Hangul block, not just syllables + Jamo.
export function isHangul(cp) {
  return (
    (cp >= 0xac00 && cp <= 0xd7af) || // syllables
    (cp >= 0x1100 && cp <= 0x11ff) || // Jamo
    (cp >= 0x3130 && cp <= 0x318f) || // Compatibility Jamo
    (cp >= 0xa960 && cp <= 0xa97f) || // Jamo Extended-A
    (cp >= 0xd7b0 && cp <= 0xd7ff) // Jamo Extended-B
  );
}

// 改行・BOM・ゼロ幅/方向制御など、グリフを持たない制御・書式文字は収集しない
function isControlOrFormat(cp) {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0xa0) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    cp === 0xfeff
  );
}

// UI文字列の収集はソースからの自動抽出で行う（手書きリストは16文字の取り
// こぼしを起こした実績があるため廃止）。コメントを除去した上で非ASCII文字を
// すべて拾う。除去しきれないコメント由来の文字が数十字混入しうるが、サイズ
// 影響は+十数KB程度で、UI文字の取りこぼし（単語内での書体混植）より害が
// 小さい。ソースフォントに無い文字（絵文字等）はhb-subsetが無視するので
// 過剰包含のコストはさらに下がる。
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // "https://…" のようなURLを壊さないよう、直前が ':' の '//' は残す
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

async function walkSourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkSourceFiles(p)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p);
  }
  return out;
}

// src/ の .ts/.tsx（テスト除く）から、コメント除去後の非ASCII文字を収集する。
// UI_TEXTS(i18n.ts)・JSX内のハードコード文言・aria-label・エラーメッセージが対象。
export async function collectUiCharacters() {
  const set = new Set();
  for (const file of await walkSourceFiles(path.join(rootDir, "src"))) {
    const text = stripComments(await readFile(file, "utf8"));
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7e && !isHangul(cp) && !isControlOrFormat(cp)) set.add(ch);
    }
  }
  return set;
}

export async function collectCharacters() {
  const set = new Set();
  for (const [lo, hi] of STATIC_RANGES) {
    for (let cp = lo; cp <= hi; cp += 1) set.add(String.fromCodePoint(cp));
  }

  for (const name of DATA_FILES) {
    const raw = JSON.parse(await readFile(path.join(rootDir, "data", name), "utf8"));
    const items = Array.isArray(raw) ? raw : raw.data ?? [];
    for (const item of items) {
      for (const field of DATA_FIELDS) {
        for (const ch of String(item?.[field] ?? "")) {
          const cp = ch.codePointAt(0);
          if (!isHangul(cp) && !isControlOrFormat(cp)) set.add(ch);
        }
      }
    }
  }

  for (const ch of await collectUiCharacters()) set.add(ch);
  return [...set].join("");
}

// sfnt(TTF)のcmapを解析し、グリフが割り当てられたコードポイント集合を返す。
// format 12 (full Unicode) を優先し、無ければ format 4 (BMP) を読む。
export function parseCmap(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap") {
      cmapOffset = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (cmapOffset < 0) throw new Error("cmap table not found");

  const subtableCount = buf.readUInt16BE(cmapOffset + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < subtableCount; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = buf.readUInt32BE(rec + 4);
    const score =
      platform === 3 && encoding === 10 ? 4
      : platform === 0 && encoding >= 4 ? 3
      : platform === 3 && encoding === 1 ? 2
      : platform === 0 ? 1
      : 0;
    if (score > bestScore) {
      bestScore = score;
      best = cmapOffset + offset;
    }
  }
  // score 0 = 未知のplatform/encoding（例: Macintosh、symbol）。誤って
  // Unicodeとして解釈しないよう、認識できるサブテーブルが無ければ失敗させる。
  if (bestScore < 1) throw new Error("no usable Unicode cmap subtable");

  const format = buf.readUInt16BE(best);
  const codepoints = new Set();
  if (format === 12) {
    const groupCount = buf.readUInt32BE(best + 12);
    for (let g = 0; g < groupCount; g += 1) {
      const rec = best + 16 + g * 12;
      const start = buf.readUInt32BE(rec);
      const end = buf.readUInt32BE(rec + 4);
      for (let cp = start; cp <= end; cp += 1) codepoints.add(cp);
    }
  } else if (format === 4) {
    const segCountX2 = buf.readUInt16BE(best + 6);
    const endBase = best + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    for (let s = 0; s < segCountX2 / 2; s += 1) {
      const end = buf.readUInt16BE(endBase + s * 2);
      const start = buf.readUInt16BE(startBase + s * 2);
      if (start === 0xffff) continue;
      const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
      const delta = buf.readInt16BE(deltaBase + s * 2);
      for (let cp = start; cp <= end; cp += 1) {
        if (rangeOffset === 0) {
          if (((cp + delta) & 0xffff) !== 0) codepoints.add(cp);
        } else {
          const glyphAt = rangeBase + s * 2 + rangeOffset + (cp - start) * 2;
          if (buf.readUInt16BE(glyphAt) !== 0) codepoints.add(cp);
        }
      }
    }
  } else {
    throw new Error(`unsupported cmap subtable format ${format}`);
  }
  return codepoints;
}

function listSfntTables(buf) {
  const tables = new Set();
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    tables.add(buf.toString("ascii", 12 + i * 16, 16 + i * 16));
  }
  return tables;
}

async function fetchSource(source) {
  const cached = path.join(cacheDir, source.file);
  try {
    const buf = await readFile(cached);
    if (createHash("sha256").update(buf).digest("hex") === source.sha256) {
      return buf;
    }
  } catch {
    // Cache miss: download below.
  }
  const url = `https://raw.githubusercontent.com/google/fonts/${SOURCE_COMMIT}/ofl/${source.dir}/${encodeURIComponent(source.file)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${source.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== source.sha256) {
    throw new Error(`sha256 mismatch for ${source.file}: got ${digest}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

async function main() {
  const text = await collectCharacters();
  console.log(`subset characters: ${[...text].length}`);
  await mkdir(outDir, { recursive: true });

  const manifest = {
    source: `google/fonts@${SOURCE_COMMIT} ofl/mplus2`,
    characterCount: [...text].length,
    files: {},
  };

  for (const source of SOURCES) {
    const ttf = await fetchSource(source);
    const woff2 = await subsetFont(ttf, text, { targetFormat: "woff2" });
    // 検証はwoff2そのものではなく、同一テキスト・同一エンジンでコンテナだけ
    // sfntにした出力に対して行う（woff2はテーブル変換を含み解析コストが高い。
    // hb-subsetにおいて両者はコンテナ包装のみの差）。
    const sfnt = await subsetFont(ttf, text, { targetFormat: "sfnt" });

    // wght軸の生存確認。hb-subsetは既定で可変軸を保持するが、もし将来の
    // ライブラリ更新で落ちたら太字が全て合成ボールドになるので即失敗させる。
    const tables = listSfntTables(sfnt);
    if (!tables.has("fvar") || !tables.has("gvar")) {
      throw new Error(`variation axes were stripped from ${source.file} (fvar/gvar missing)`);
    }

    // cmap網羅検証: ソースフォントに存在する要求文字が、すべて出力にも
    // 存在すること。ソースに無い文字（絵文字等）はシステムフォールバック
    // 前提として許容し、マニフェストへ記録する。
    const sourceCmap = parseCmap(ttf);
    const outputCmap = parseCmap(sfnt);
    const covered = [];
    const fallback = [];
    const missing = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (!sourceCmap.has(cp)) fallback.push(ch);
      else if (outputCmap.has(cp)) covered.push(ch);
      else missing.push(ch);
    }
    if (missing.length > 0) {
      throw new Error(
        `subset dropped ${missing.length} character(s) present in the source font: ${missing.join("")}`,
      );
    }

    const outPath = path.join(outDir, source.out);
    let previous = null;
    try {
      previous = await readFile(outPath);
    } catch {
      // First generation.
    }
    if (!previous || !previous.equals(woff2)) {
      await writeFile(outPath, woff2);
    }
    manifest.files[source.out] = {
      bytes: woff2.length,
      from: source.file,
    };
    manifest.coveredChars = covered.sort().join("");
    manifest.fallbackChars = fallback.sort().join("");
    console.log(
      `${source.out}: ${(woff2.length / 1024).toFixed(1)}KB (from ${(ttf.length / 1024 / 1024).toFixed(1)}MB), ` +
        `covered ${covered.length}, system-fallback ${fallback.length} [${fallback.join("")}]`,
    );
  }

  await writeFile(
    path.join(outDir, "subset-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

const invokedAsCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
