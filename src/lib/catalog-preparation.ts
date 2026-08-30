import type { AkyoData } from "@/types/akyo";
import { formatDisplayId } from "@/lib/akyo-entry";

const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;
const DEFAULT_TIME_BUDGET_MS = 8;

interface CatalogPreparationOptions {
  signal?: AbortSignal;
  timeBudgetMs?: number;
  now?: () => number;
  yieldToMainThread?: () => Promise<void>;
}

function throwIfCatalogPreparationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Catalog preparation was aborted", "AbortError");
  }
}

interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

function toHiragana(value: string): string {
  return value.replace(/[\u30A1-\u30F6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );
}

function toKatakana(value: string): string {
  return value.replace(/[\u3041-\u3096]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x60),
  );
}

export function normalizeCatalogSearchValue(
  value: string | undefined,
): string[] {
  const base = String(value || "")
    .trim()
    .normalize("NFC")
    .toLowerCase();
  if (!base) return [];

  return Array.from(new Set([base, toHiragana(base), toKatakana(base)]));
}

export function parseCatalogMultiValueField(value: string): string[] {
  return value
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildCatalogSearchIndex(akyo: AkyoData): string[] {
  const searchTargets = [
    akyo.id || "",
    formatDisplayId(akyo),
    akyo.nickname || "",
    akyo.avatarName || "",
    akyo.category || akyo.attribute || "",
    akyo.author || akyo.creator || "",
    akyo.comment || akyo.notes || "",
  ];

  return searchTargets.flatMap((value) => normalizeCatalogSearchValue(value));
}

function prepareCatalogItem(item: AkyoData): AkyoData {
  if (item.parsedCategory && item.parsedAuthor && item._searchIndex) {
    return item;
  }

  return {
    ...item,
    parsedCategory:
      item.parsedCategory ??
      parseCatalogMultiValueField(item.category || item.attribute || ""),
    parsedAuthor:
      item.parsedAuthor ??
      parseCatalogMultiValueField(item.author || item.creator || ""),
    _searchIndex: item._searchIndex ?? buildCatalogSearchIndex(item),
  };
}

export function prepareCatalogItems(items: readonly AkyoData[]): AkyoData[] {
  return items.map(prepareCatalogItem);
}

async function defaultYieldToMainThread(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: SchedulerWithYield }
  ).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function prepareCatalogItemsInChunks(
  items: readonly AkyoData[],
  options: CatalogPreparationOptions = {},
): Promise<AkyoData[]> {
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const now = options.now ?? (() => performance.now());
  const yieldToMainThread =
    options.yieldToMainThread ?? defaultYieldToMainThread;
  const prepared: AkyoData[] = [];
  let sliceStartedAt = now();

  for (let index = 0; index < items.length; index += 1) {
    throwIfCatalogPreparationAborted(options.signal);
    prepared.push(prepareCatalogItem(items[index]!));
    if (index === items.length - 1 || now() - sliceStartedAt < timeBudgetMs) {
      continue;
    }

    await yieldToMainThread();
    throwIfCatalogPreparationAborted(options.signal);
    sliceStartedAt = now();
  }

  return prepared;
}

function equalStringArrays(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function areEquivalentCatalogItems(left: AkyoData, right: AkyoData): boolean {
  return (
    left.id === right.id &&
    left.entryType === right.entryType &&
    left.displaySerial === right.displaySerial &&
    left.appearance === right.appearance &&
    left.nickname === right.nickname &&
    left.avatarName === right.avatarName &&
    left.sourceUrl === right.sourceUrl &&
    left.boothUrl === right.boothUrl &&
    left.category === right.category &&
    left.comment === right.comment &&
    left.author === right.author &&
    left.attribute === right.attribute &&
    left.notes === right.notes &&
    left.creator === right.creator &&
    left.avatarUrl === right.avatarUrl &&
    left.isFavorite === right.isFavorite &&
    equalStringArrays(left.parsedCategory, right.parsedCategory) &&
    equalStringArrays(left.parsedAuthor, right.parsedAuthor) &&
    equalStringArrays(left._searchIndex, right._searchIndex)
  );
}

export function applyFavoritesToPreparedCatalog(
  items: readonly AkyoData[],
  favoriteIds: readonly string[],
  previousItems: readonly AkyoData[] = [],
): AkyoData[] {
  const favorites = new Set(favoriteIds);
  const previousById = new Map(previousItems.map((item) => [item.id, item]));

  return items.map((item) => {
    const isFavorite = favorites.has(item.id);
    const nextItem =
      item.isFavorite === isFavorite ? item : { ...item, isFavorite };
    const previous = previousById.get(item.id);
    return previous && areEquivalentCatalogItems(previous, nextItem)
      ? previous
      : nextItem;
  });
}

export function haveSameCatalogItemReferences(
  left: readonly AkyoData[],
  right: readonly AkyoData[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}
