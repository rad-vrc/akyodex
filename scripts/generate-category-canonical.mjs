/**
 * Generate the cross-language category canonicalization map.
 *
 * カテゴリ色はJAのカテゴリ名を基準に決まる（CATEGORY_COLOR_MAP＋ハッシュ
 * フォールバック）ため、EN/KOのカテゴリ名はそのままだと別の色に散らばる
 * （例: パロディ/Parody/패러디 が三者三様）。ja/en/koのデータは同一IDが
 * 同一Akyoの対訳なので、ここから EN/KO最上位カテゴリ → JA最上位カテゴリ の
 * 辞書を多数決で生成し、色計算前の正規化に使う。
 *
 * 出力: src/lib/category-canonical.json （{ "Animal": "動物", "동물": "動物", ... }）
 * データ同期ワークフローが再実行するため、新カテゴリにも自動追従する。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(rootDir, "src", "lib", "category-canonical.json");

const loadCategories = async (langCode) => {
  const raw = JSON.parse(
    await readFile(path.join(rootDir, "data", `akyo-data-${langCode}.json`), "utf8"),
  );
  const items = Array.isArray(raw) ? raw : raw.data ?? [];
  return new Map(items.map((item) => [item.id, String(item.category || "")]));
};

const topLevels = (categoryField) =>
  categoryField.split(",").map((c) => c.split("/")[0].trim());

async function main() {
  const [ja, en, ko] = await Promise.all([
    loadCategories("ja"),
    loadCategories("en"),
    loadCategories("ko"),
  ]);

  // foreignTop -> Map(jaTop -> count)。カンマ区切りの同一位置を対訳とみなす
  const votes = new Map();
  for (const [id, jaCat] of ja) {
    const jaTops = topLevels(jaCat);
    for (const [langMap] of [[en], [ko]]) {
      const foreignTops = topLevels(langMap.get(id) || "");
      jaTops.forEach((jaTop, i) => {
        const foreign = foreignTops[i];
        if (!jaTop || !foreign || foreign === jaTop) return;
        if (!votes.has(foreign)) votes.set(foreign, new Map());
        const v = votes.get(foreign);
        v.set(jaTop, (v.get(jaTop) || 0) + 1);
      });
    }
  }

  // 多数決で正規名を確定（翻訳ゆれ: 例 EN"Animal" が「貝」の行にも現れる → 最多の「動物」へ）
  // Mapで保持: 素のオブジェクトへの代入だと "__proto__" というカテゴリ名が
  // 辞書エントリにならずprototype操作になる。Object.fromEntriesは
  // CreateDataPropertyで定義するため__proto__キーも安全に通常プロパティになる。
  const canonical = new Map();
  for (const [foreign, v] of votes) {
    const [winner] = [...v.entries()].sort((a, b) => b[1] - a[1])[0];
    canonical.set(foreign, winner);
  }

  const sorted = Object.fromEntries(
    [...canonical.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(outPath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`category-canonical.json: ${Object.keys(sorted).length} entries`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
