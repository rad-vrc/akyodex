import type { SupportedLanguage } from "@/lib/i18n";
import type { AkyoData } from "@/types/akyo";

export interface LanguageDatasetCacheEntry {
  items: AkyoData[];
  categories: string[];
  authors: string[];
  complete: boolean;
}

export function createLanguageDatasetCacheEntry(args: {
  items: AkyoData[];
  categories: string[];
  authors: string[];
  complete: boolean;
}): LanguageDatasetCacheEntry {
  return {
    items: args.items,
    categories: args.categories,
    authors: args.authors,
    complete: args.complete,
  };
}

export function resolveImmediateLanguageDataset(args: {
  lang: SupportedLanguage;
  serverLang: SupportedLanguage;
  cachedDataset?: LanguageDatasetCacheEntry;
  serverDataset: LanguageDatasetCacheEntry;
}): LanguageDatasetCacheEntry | null {
  const { lang, serverLang, cachedDataset, serverDataset } = args;

  if (lang === serverLang) {
    return cachedDataset ?? serverDataset;
  }

  return cachedDataset ?? null;
}
