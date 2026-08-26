import {
  getDisplaySerialNumber,
  resolveEntryType,
} from "@/lib/akyo-entry";
import type { AkyoData } from "@/types/akyo";

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
  totals: CatalogTotals;
  complete: false;
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

export function createInitialCatalogPayload(
  items: readonly AkyoData[],
): InitialCatalogPayload {
  const sortedItems = sortCatalogForDisplay(items);
  return {
    items: sortedItems.slice(0, INITIAL_CATALOG_ITEM_COUNT),
    totals: summarizeCatalog(items),
    complete: false,
  };
}
