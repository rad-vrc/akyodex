/**
 * Generate a self-hosted M PLUS 2 subset from the live catalog data.
 *
 * The full variable font is ~4.2MB. This script keeps only the characters
 * the site can actually render — every name/author/category/comment across
 * the ja/en/ko catalogs, all kana, ASCII, and Japanese punctuation — and
 * preserves the wght variation axis, producing a single woff2 that serves
 * every weight (400/500/700/900...) from one file committed to src/fonts/.
 *
 * Characters that appear in future catalog updates but are missing from the
 * committed subset fall back to the system font stack (no tofu). The data
 * sync workflow re-runs this script so the subset follows the data.
 *
 * The source TTF is pinned to a google/fonts commit and verified by sha256.
 * License: SIL OFL 1.1 (see src/fonts/LICENSE-MPLUS2.txt).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

// UI wording that must render even if it never appears in catalog data.
const STATIC_UI =
  "図鑑検索閉開表示件商品作者名前通称詳細言語切替再試行読込完了失敗更新管理設定" +
  "全部分類属性絞込並替昇降順無作為抽出候補結果情報画像三面保存共有公式接続中";

function isHangul(cp) {
  return (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff);
}

async function collectCharacters() {
  const set = new Set();
  for (const [lo, hi] of STATIC_RANGES) {
    for (let cp = lo; cp <= hi; cp += 1) set.add(String.fromCodePoint(cp));
  }
  for (const ch of STATIC_UI) set.add(ch);

  for (const name of DATA_FILES) {
    const raw = JSON.parse(await readFile(path.join(rootDir, "data", name), "utf8"));
    const items = Array.isArray(raw) ? raw : raw.data ?? [];
    for (const item of items) {
      for (const field of DATA_FIELDS) {
        for (const ch of String(item?.[field] ?? "")) {
          const cp = ch.codePointAt(0);
          // Korean text intentionally falls back to the system stack.
          if (!isHangul(cp)) set.add(ch);
        }
      }
    }
  }
  return [...set].join("");
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
    // wght軸の生存確認。hb-subsetは既定で可変軸を保持するが、もし将来の
    // ライブラリ更新で落ちたら太字が全て合成ボールドになるので即失敗させる。
    const sfnt = await subsetFont(ttf, "あ", { targetFormat: "sfnt" });
    const tables = new Set();
    const numTables = sfnt.readUInt16BE(4);
    for (let i = 0; i < numTables; i += 1) {
      tables.add(sfnt.toString("ascii", 12 + i * 16, 16 + i * 16));
    }
    if (!tables.has("fvar") || !tables.has("gvar")) {
      throw new Error(`variation axes were stripped from ${source.file} (fvar/gvar missing)`);
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
    console.log(`${source.out}: ${(woff2.length / 1024).toFixed(1)}KB (from ${(ttf.length / 1024 / 1024).toFixed(1)}MB)`);
  }

  await writeFile(
    path.join(outDir, "subset-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
