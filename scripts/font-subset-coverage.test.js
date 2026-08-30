const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const manifest = require("../src/fonts/subset-manifest.json");

async function loadGenerator() {
  return import(
    pathToFileURL(path.join(__dirname, "generate-font-subsets.mjs")).href
  );
}

// 収集対象の全文字が manifest（フォント収録 or 明示フォールバック）に載って
// いること。落ちたら「新しい文字が追加されたのにサブセット未再生成」の状態。
test("subset manifest is in sync with the current character inventory", async () => {
  const { collectCharacters } = await loadGenerator();
  const text = await collectCharacters();
  const known = new Set([...manifest.coveredChars, ...manifest.fallbackChars]);
  const missing = [...text].filter((ch) => !known.has(ch));
  assert.deepEqual(
    missing,
    [],
    `subset is stale — run \`npm run fonts:subset\` and commit src/fonts/ (unknown chars: ${missing.join("")})`,
  );
});

// UIソース由来の和文文字（かな・CJK漢字・和文記号・全角形）が、システム
// フォールバックではなく実際にフォントへ収録されていること。データ由来の
// 簡体字や絵文字のフォールバックは正常なので対象外。
test("Japanese UI characters are served by the web font, not the fallback stack", async () => {
  const { collectUiCharacters } = await loadGenerator();
  const uiChars = await collectUiCharacters();
  const fallback = new Set(manifest.fallbackChars);
  const isJapanese = (cp) =>
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xff01 && cp <= 0xff65);
  const offenders = [...uiChars].filter(
    (ch) => isJapanese(ch.codePointAt(0)) && fallback.has(ch),
  );
  assert.deepEqual(
    offenders,
    [],
    `UI chars missing from the font (would render mixed-typeface): ${offenders.join("")}`,
  );
});
