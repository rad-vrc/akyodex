import {
  getAkyoSourceUrl,
  getDisplaySerialNumber,
  resolveEntryType,
} from "@/lib/akyo-entry";
import type { AkyoData, AkyoEntryType } from "@/types/akyo";

export const INITIAL_CATALOG_ITEM_COUNT = 12;

export interface CatalogTotals {
  entries: number;
  avatars: number;
  worlds: number;
  products: number;
  favorites: number;
}

export interface InitialCatalogPayload {
  items: AkyoData[];
  previewItems: CatalogPreviewItem[];
  totals: CatalogTotals;
  complete: false;
}

export interface CatalogPreviewItem {
  id: string;
  entryType: AkyoEntryType;
  displaySerial?: string;
  nickname: string;
  avatarName: string;
  category: string;
  author: string;
  sourceUrl?: string;
  boothUrl?: string;
}

function getCatalogSortNumber(item: AkyoData): number {
  return getDisplaySerialNumber(item) ?? (Number.parseInt(item.id, 10) || 0);
}

export function sortCatalogForDisplay(items: readonly AkyoData[]): AkyoData[] {
  return [...items].sort(
    (left, right) => getCatalogSortNumber(left) - getCatalogSortNumber(right),
  );
}

export function summarizeCatalog(items: readonly AkyoData[]): CatalogTotals {
  return items.reduce<CatalogTotals>(
    (totals, item) => {
      const entryType = resolveEntryType(item);
      totals.entries += 1;
      if (entryType === "avatar") totals.avatars += 1;
      if (entryType === "world") totals.worlds += 1;
      if (item.boothUrl) totals.products += 1;
      if (item.isFavorite) totals.favorites += 1;
      return totals;
    },
    { entries: 0, avatars: 0, worlds: 0, products: 0, favorites: 0 },
  );
}

function createCatalogPreviewItem(item: AkyoData): CatalogPreviewItem {
  const entryType = resolveEntryType(item);
  return {
    id: item.id,
    entryType,
    displaySerial: item.displaySerial,
    nickname: item.nickname,
    avatarName: item.avatarName,
    category: item.category || item.attribute,
    author: item.author || item.creator,
    // Avatar thumbnails use the stable catalog ID. Keep only world source URLs,
    // which are required to resolve live world thumbnails before full data loads.
    sourceUrl:
      entryType === "world" ? getAkyoSourceUrl(item) || undefined : undefined,
    boothUrl: item.boothUrl || undefined,
  };
}

export function expandCatalogPreviewItems(
  items: readonly CatalogPreviewItem[],
): AkyoData[] {
  return items.map((item) => ({
    id: item.id,
    entryType: item.entryType,
    displaySerial: item.displaySerial,
    appearance: "",
    nickname: item.nickname,
    avatarName: item.avatarName,
    category: item.category,
    comment: "",
    author: item.author,
    attribute: item.category,
    notes: "",
    creator: item.author,
    sourceUrl: item.sourceUrl,
    boothUrl: item.boothUrl,
    avatarUrl: item.sourceUrl ?? "",
  }));
}

export function createInitialCatalogPayload(
  items: readonly AkyoData[],
): InitialCatalogPayload {
  const sortedItems = sortCatalogForDisplay(items);
  return {
    items: sortedItems.slice(0, INITIAL_CATALOG_ITEM_COUNT),
    previewItems: sortedItems.map(createCatalogPreviewItem),
    totals: summarizeCatalog(items),
    complete: false,
  };
}
