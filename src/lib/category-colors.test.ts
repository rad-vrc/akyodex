import assert from "node:assert/strict";
import test from "node:test";

import jaToEnCategoryMap from "../../scripts/category-ja-en-map.js";
import koCategoryDefinitions from "../../scripts/category-definitions-ko.js";
import { getCategoryColor } from "./akyo-data-helpers";
import {
  getCategoryBadgeColors,
  getCategoryVisualGroup,
} from "./category-colors";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test("category colors stay consistent across Japanese, English, and Korean", () => {
  const translations = [
    ["動物", "Animal", "동물"],
    ["食べ物", "Food", "음식"],
    ["ワールド", "World", "월드"],
    ["ファッション", "Fashion", "패션"],
    ["架空の存在", "Fictional Being", "가상의 존재"],
  ];

  translations.forEach(([ja, en, ko]) => {
    assert.equal(getCategoryColor(en), getCategoryColor(ja), `${en} should match ${ja}`);
    assert.equal(getCategoryColor(ko), getCategoryColor(ja), `${ko} should match ${ja}`);
  });
});

test("child categories retain their parent category accent", () => {
  const hierarchies = [
    ["Booth", "Booth/アバター"],
    ["食べ物", "食べ物/料理/揚げ物"],
    ["Animal", "Animal/Bug/Butterfly"],
    ["음식", "음식/요리/튀김"],
  ];

  hierarchies.forEach(([parent, child]) => {
    assert.equal(getCategoryColor(child), getCategoryColor(parent), child);
  });
});

test("unmapped child categories hash from their root category", () => {
  assert.equal(getCategoryColor("未登録"), getCategoryColor("未登録/子カテゴリ"));
});

test("top-level categories resolve to the intended visual groups", () => {
  const expectedGroups = [
    ["動物", "living"],
    ["環境・天候", "nature"],
    ["Food/Dish/Fried", "food"],
    ["패션/헤어스타일", "appearance"],
    ["Role・Status/Scientist", "society"],
    ["電子", "technology"],
    ["계절・행사/칠석", "world"],
    ["Skill・Trait/Magic", "ability"],
    ["パロディ/VRChat", "culture"],
  ] as const;

  expectedGroups.forEach(([category, expectedGroup]) => {
    assert.equal(getCategoryVisualGroup(category), expectedGroup, category);
  });
});

test("all registered translations retain the Japanese source color", () => {
  const jaToKoCategoryMap = (
    koCategoryDefinitions as { CATEGORY_MAP: Record<string, string> }
  ).CATEGORY_MAP;

  Object.entries(jaToEnCategoryMap as Record<string, string>).forEach(
    ([jaCategory, enCategory]) => {
      assert.equal(
        getCategoryColor(enCategory),
        getCategoryColor(jaCategory),
        `${enCategory} should match ${jaCategory}`,
      );
    },
  );

  Object.entries(jaToKoCategoryMap).forEach(([jaCategory, koCategory]) => {
    assert.equal(
      getCategoryColor(koCategory),
      getCategoryColor(jaCategory),
      `${koCategory} should match ${jaCategory}`,
    );
  });
});

test("badge colors are opaque and meet WCAG AA at every hierarchy depth", () => {
  const categories = [
    "動物",
    "植物/苔",
    "Food/Dish/Fried",
    "패션/헤어스타일/모히칸",
    "身分・役割/科学者",
    "Electronic",
    "계절・행사/칠석",
    "Skill・Trait/Magic",
    "パロディ/VRChat",
  ];

  categories.forEach((category) => {
    const colors = getCategoryBadgeColors(category);
    assert.match(colors.background, /^#[0-9a-f]{6}$/i, category);
    assert.ok(
      contrastRatio(colors.text, colors.background) >= 4.5,
      `${category}: ${colors.text} on ${colors.background}`,
    );
  });
});

test("hierarchy depth changes the surface treatment but not the accent", () => {
  const root = getCategoryBadgeColors("食べ物");
  const child = getCategoryBadgeColors("食べ物/料理");
  const grandchild = getCategoryBadgeColors("食べ物/料理/揚げ物");

  assert.equal(child.accent, root.accent);
  assert.equal(grandchild.accent, root.accent);
  assert.notEqual(child.background, root.background);
  assert.notEqual(grandchild.background, child.background);
  assert.notEqual(child.border, root.border);
  assert.notEqual(grandchild.border, child.border);
});
