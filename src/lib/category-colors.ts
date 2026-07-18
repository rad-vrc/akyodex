import jaToEnCategoryMap from "../../scripts/category-ja-en-map.js";
import koCategoryDefinitions from "../../scripts/category-definitions-ko.js";

export type CategoryVisualGroup =
  | "living"
  | "nature"
  | "food"
  | "appearance"
  | "society"
  | "technology"
  | "world"
  | "ability"
  | "culture";

type CategoryPaletteEntry = {
  accent: string;
};

export type CategoryBadgeColors = {
  accent: string;
  background: string;
  border: string;
  text: string;
};

const CATEGORY_PALETTE: Record<CategoryVisualGroup, CategoryPaletteEntry> = {
  living: { accent: "#cc6677" },
  nature: { accent: "#228833" },
  food: { accent: "#c47a00" },
  appearance: { accent: "#aa4499" },
  society: { accent: "#4477aa" },
  technology: { accent: "#008c95" },
  world: { accent: "#887b12" },
  ability: { accent: "#b4472f" },
  culture: { accent: "#5f5f66" },
};

const CATEGORY_ROOTS_BY_GROUP: Record<CategoryVisualGroup, readonly string[]> = {
  living: [
    "動物",
    "架空の存在",
    "まめ",
    "まめAkyo",
    "精霊馬",
    "貝",
    "ネコ",
    "イヌ",
    "うさぎ",
    "きつね",
    "おばけ",
  ],
  nature: ["植物", "菌類", "環境・天候", "自然・天候"],
  food: ["チョコミント類", "食べ物", "飲み物", "調味料"],
  appearance: [
    "ファッション",
    "衣類・衣装",
    "なりきり・仮装",
    "マスク",
    "メガネ",
    "体型",
    "豊満",
    "器官",
    "形状・触り心地",
    "色",
    "デフォルメ",
    "ローポリ",
    "フィジカル",
    "高身長",
    "四足歩行",
    "プリティ",
    "グロテスク",
    "骨",
    "ばんそうこう",
    "かわいい",
    "クール",
    "シンプル",
  ],
  society: [
    "身分・役割",
    "職業・家柄",
    "性格・趣向",
    "関係性",
    "集団・組織",
    "国",
    "学校",
    "歴史",
    "年齢層",
    "お年寄り",
    "子ども",
    "頂に立つ者",
    "囚われの身",
  ],
  technology: [
    "乗り物",
    "武器・機械",
    "道具・文房具・生活用品",
    "道具",
    "電子",
    "ロボット",
    "家電・家具",
    "お布団",
    "枕",
    "設備",
    "お風呂",
    "建物",
    "素材・原材料",
    "液体",
    "エネルギー",
    "危険物",
  ],
  world: ["季節・行事", "ハロウィン", "次元", "ワールド", "惑星", "宇宙"],
  ability: [
    "ギミック・特殊",
    "ギミック",
    "特殊",
    "技能・特性",
    "ひこう",
    "合体・変身",
    "状態",
    "病気・ウイルス",
    "死",
    "復活",
    "睡眠",
    "お大事に",
    "最強戦士",
    "頭脳明晰",
  ],
  culture: [
    "Booth",
    "パロディ",
    "芸術・アート",
    "音楽・楽器",
    "ホラー",
    "像・埴輪",
    "実写",
    "レア",
    "正体不明のUMAkyo",
    "正体不明",
    "願い事",
    "おくりもの",
    "和風",
    "洋風",
    "ファンタジー",
    "SF",
    "未分類",
  ],
};

const jaToKoCategoryMap = (
  koCategoryDefinitions as { CATEGORY_MAP: Record<string, string> }
).CATEGORY_MAP;

const categoryGroupByRoot = new Map<string, CategoryVisualGroup>();
const categoryGroupByLocalizedCategory = new Map<string, CategoryVisualGroup>();

for (const [group, roots] of Object.entries(CATEGORY_ROOTS_BY_GROUP) as [
  CategoryVisualGroup,
  readonly string[],
][]) {
  roots.forEach((root) => categoryGroupByRoot.set(root, group));
}

function getFallbackGroup(root: string): CategoryVisualGroup {
  const groups = Object.keys(CATEGORY_PALETTE) as CategoryVisualGroup[];
  return groups[hashString(root) % groups.length];
}

function registerLocalizedCategory(jaCategory: string, localizedCategory: string): void {
  const jaRoot = jaCategory.split("/")[0] || "";
  const localizedRoot = localizedCategory.split("/")[0] || "";
  const group = categoryGroupByRoot.get(jaRoot) ?? getFallbackGroup(jaRoot);

  categoryGroupByLocalizedCategory.set(jaCategory, group);
  categoryGroupByLocalizedCategory.set(localizedCategory, group);

  if (!categoryGroupByRoot.has(localizedRoot)) {
    categoryGroupByRoot.set(localizedRoot, group);
  }
}

for (const [jaCategory, enCategory] of Object.entries(
  jaToEnCategoryMap as Record<string, string>,
)) {
  registerLocalizedCategory(jaCategory, enCategory);
}

for (const [jaCategory, koCategory] of Object.entries(jaToKoCategoryMap)) {
  registerLocalizedCategory(jaCategory, koCategory);
}

function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) + hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  ) as [number, number, number];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function mixHex(from: string, to: string, toWeight: number): string {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);
  return rgbToHex(
    fromRgb[0] * (1 - toWeight) + toRgb[0] * toWeight,
    fromRgb[1] * (1 - toWeight) + toRgb[1] * toWeight,
    fromRgb[2] * (1 - toWeight) + toRgb[2] * toWeight,
  );
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function getAccessibleTextColor(accent: string, background: string): string {
  if (contrastRatio(accent, background) >= 4.5) {
    return accent;
  }

  for (let blackWeight = 0.05; blackWeight <= 1; blackWeight += 0.05) {
    const candidate = mixHex(accent, "#000000", blackWeight);
    if (contrastRatio(candidate, background) >= 4.5) {
      return candidate;
    }
  }

  return "#000000";
}

export function getCategoryVisualGroup(category: string): CategoryVisualGroup {
  const localizedGroup = categoryGroupByLocalizedCategory.get(category);
  if (localizedGroup) {
    return localizedGroup;
  }

  const root = category.split("/")[0] || "";
  return categoryGroupByRoot.get(root) ?? getFallbackGroup(root);
}

export function getCategoryColor(category: string): string {
  return CATEGORY_PALETTE[getCategoryVisualGroup(category)].accent;
}

export function getCategoryBadgeColors(category: string): CategoryBadgeColors {
  const accent = getCategoryColor(category);
  const depth = Math.min(Math.max(category.split("/").length - 1, 0), 2);
  const backgroundWeights = [0.1, 0.15, 0.2];
  const borderWeights = [0.35, 0.5, 0.65];
  const background = mixHex("#ffffff", accent, backgroundWeights[depth]);

  return {
    accent,
    background,
    border: mixHex("#ffffff", accent, borderWeights[depth]),
    text: getAccessibleTextColor(accent, background),
  };
}
