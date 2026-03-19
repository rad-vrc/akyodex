"use client";

import type { AkyoData, AkyoFilterOptions } from "@/types/akyo";
import {
  formatDisplayId,
  getDisplaySerialNumber,
  resolveEntryType,
} from "@/lib/akyo-entry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** localStorage のキー名 */
const FAVORITES_STORAGE_KEY = "akyoFavorites";
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;
const FAVORITE_PERSIST_RETRY_BASE_DELAY_MS = 1000;
const FAVORITE_PERSIST_RETRY_MAX_DELAY_MS = 30000;
export type FavoriteOverrides = Record<string, boolean>;

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

function normalizeSearchValue(value: string | undefined): string[] {
  const base = String(value || "")
    .trim()
    .normalize("NFC")
    .toLowerCase();
  if (!base) return [];

  const variants = new Set([base, toHiragana(base), toKatakana(base)]);
  return Array.from(variants);
}

/**
 * データ項目の検索用正規化テキストを事前計算する。
 * filterData() で毎回 normalizeSearchValue() を呼ぶ代わりに、
 * データ読み込み時に一度だけ計算してキャッシュする。
 */
function buildSearchIndex(akyo: AkyoData): string[] {
  const searchTargets = [
    akyo.id || "",
    formatDisplayId(akyo),
    akyo.nickname || "",
    akyo.avatarName || "",
    akyo.category || akyo.attribute || "",
    akyo.author || akyo.creator || "",
    akyo.comment || akyo.notes || "",
  ];
  return searchTargets.flatMap((value) => normalizeSearchValue(value));
}

/**
 * データ配列に parsedCategory / parsedAuthor / _searchIndex を事前計算して付与する。
 */
function enrichDataForSearch(items: AkyoData[]): AkyoData[] {
  if (items.length === 0) return items;
  return items.map((akyo) => ({
    ...akyo,
    parsedCategory:
      akyo.parsedCategory ??
      parseMultiValueField(akyo.category || akyo.attribute || ""),
    parsedAuthor:
      akyo.parsedAuthor ??
      parseMultiValueField(akyo.author || akyo.creator || ""),
    _searchIndex: akyo._searchIndex ?? buildSearchIndex(akyo),
  }));
}

/**
 * Akyoデータを管理するカスタムフック (SSR対応版)
 *
 * @param initialData - サーバーサイドで取得した初期データ
 */
export function useAkyoData(initialData: AkyoData[] = []) {
  // 初期状態でSSRデータを直接設定（「見つかりませんでした」の一瞬表示を防止）
  const [data, setData] = useState<AkyoData[]>(initialData);
  const [filteredData, setFilteredData] = useState<AkyoData[]>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<AkyoData[]>(initialData);
  const filteredDataRef = useRef<AkyoData[]>(initialData);
  const favoritesDirtyRef = useRef(false);
  const favoriteOverridesRef = useRef<FavoriteOverrides>({});
  const favoritePersistRetryTimeoutRef = useRef<number | null>(null);
  const favoritePersistRetryDelayRef = useRef<number | null>(null);
  const lastPersistedFavoritesRef = useRef<string | null>(null);
  const [favoritePersistRetryNonce, setFavoritePersistRetryNonce] = useState(0);

  const clearFavoritePersistRetry = useCallback(() => {
    if (favoritePersistRetryTimeoutRef.current !== null) {
      window.clearTimeout(favoritePersistRetryTimeoutRef.current);
      favoritePersistRetryTimeoutRef.current = null;
    }
    favoritePersistRetryDelayRef.current = null;
  }, []);

  const scheduleFavoritePersistRetry = useCallback(() => {
    if (typeof window === "undefined") return;

    if (favoritePersistRetryTimeoutRef.current !== null) {
      window.clearTimeout(favoritePersistRetryTimeoutRef.current);
    }

    const nextDelay = getNextFavoritePersistRetryDelayMs(
      favoritePersistRetryDelayRef.current,
    );
    favoritePersistRetryDelayRef.current = nextDelay;
    favoritePersistRetryTimeoutRef.current = window.setTimeout(() => {
      favoritePersistRetryTimeoutRef.current = null;
      setFavoritePersistRetryNonce((prev) => prev + 1);
    }, nextDelay);
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    filteredDataRef.current = filteredData;
  }, [filteredData]);

  useEffect(
    () => () => {
      clearFavoritePersistRetry();
    },
    [clearFavoritePersistRetry],
  );

  // クライアントサイドでお気に入り情報を復元
  useEffect(() => {
    if (initialData.length > 0) {
      const persistedFavorites = getFavorites();
      favoriteOverridesRef.current = pruneFavoriteOverrides(
        persistedFavorites,
        favoriteOverridesRef.current,
      );
      const dataWithFavorites = applyFavoritesFromIds(
        initialData,
        applyFavoriteOverrides(
          persistedFavorites,
          favoriteOverridesRef.current,
        ),
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      dataRef.current = dataWithFavorites;
      filteredDataRef.current = dataWithFavorites;
      setData(dataWithFavorites);
      setFilteredData(dataWithFavorites);
      // 初期復元時点の基準値を記録して、将来の差分判定を安定化させる
      lastPersistedFavoritesRef.current = JSON.stringify(persistedFavorites);
      favoritesDirtyRef.current =
        Object.keys(favoriteOverridesRef.current).length > 0;
    }
  }, [initialData]);

  // 別タブからの localStorage 変更を検知してお気に入り状態を同期する
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== FAVORITES_STORAGE_KEY) return;
      // キャッシュを無効化して最新の値を取得
      invalidateFavoritesCache();
      const persistedFavorites = getFavorites();
      favoriteOverridesRef.current = pruneFavoriteOverrides(
        persistedFavorites,
        favoriteOverridesRef.current,
      );
      const effectiveFavorites = applyFavoriteOverrides(
        persistedFavorites,
        favoriteOverridesRef.current,
      );
      // 別タブ更新を基準値として取り込み、次回の差分判定を正しくする
      lastPersistedFavoritesRef.current = JSON.stringify(persistedFavorites);
      favoritesDirtyRef.current =
        Object.keys(favoriteOverridesRef.current).length > 0;
      const { nextData, nextFilteredData } = syncFavoriteCollections({
        data: dataRef.current,
        filteredData: filteredDataRef.current,
        favoriteIds: effectiveFavorites,
      });
      dataRef.current = nextData;
      filteredDataRef.current = nextFilteredData;
      setData(nextData);
      setFilteredData(nextFilteredData);
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // dataの変更に合わせてお気に入りIDを永続化（state updater内の副作用を回避）
  useEffect(() => {
    if (!favoritesDirtyRef.current) {
      clearFavoritePersistRetry();
      return;
    }

    // ここでの早期 return は dirty フラグを意図的に残し、データ同期後に再判定するため
    // saveFavorites / lastPersistedFavoritesRef / favoritesDirtyRef の更新は
    // シリアライズ比較まで完了した成功経路でのみ行う
    // 初期SSRデータ（isFavorite未同期）で localStorage を空上書きしない
    if (data.length === 0) return;
    const hasFullySyncedFavoriteState = data.every(
      (item) => typeof item.isFavorite === "boolean",
    );
    if (!hasFullySyncedFavoriteState) return;

    const persistedFavorites = getFavorites();
    favoriteOverridesRef.current = pruneFavoriteOverrides(
      persistedFavorites,
      favoriteOverridesRef.current,
    );

    if (Object.keys(favoriteOverridesRef.current).length === 0) {
      clearFavoritePersistRetry();
      lastPersistedFavoritesRef.current = JSON.stringify(persistedFavorites);
      favoritesDirtyRef.current = false;
      return;
    }

    const favorites = applyFavoriteOverrides(
      persistedFavorites,
      favoriteOverridesRef.current,
    );
    const serializedFavorites = JSON.stringify(favorites);
    if (!saveFavorites(favorites)) {
      scheduleFavoritePersistRetry();
      return;
    }

    clearFavoritePersistRetry();
    favoriteOverridesRef.current = {};
    lastPersistedFavoritesRef.current = serializedFavorites;
    favoritesDirtyRef.current = false;
  }, [
    clearFavoritePersistRetry,
    data,
    favoritePersistRetryNonce,
    scheduleFavoritePersistRetry,
  ]);

  /**
   * 新しいデータでリフレッシュ（言語切り替え時などに使用）
   */
  const refetchWithNewData = useCallback((newData: AkyoData[]) => {
    const persistedFavorites = getFavorites();
    favoriteOverridesRef.current = pruneFavoriteOverrides(
      persistedFavorites,
      favoriteOverridesRef.current,
    );
    const dataWithFavorites = applyFavoritesFromIds(
      enrichDataForSearch(newData),
      applyFavoriteOverrides(persistedFavorites, favoriteOverridesRef.current),
    );
    lastPersistedFavoritesRef.current = JSON.stringify(persistedFavorites);
    favoritesDirtyRef.current =
      Object.keys(favoriteOverridesRef.current).length > 0;
    dataRef.current = dataWithFavorites;
    filteredDataRef.current = dataWithFavorites;
    setData(dataWithFavorites);
    setFilteredData(dataWithFavorites);
  }, []);

  // フィルタリング機能
  const filterData = useCallback(
    (options: AkyoFilterOptions, sortAsc: boolean = true) => {
      const normalizedQueryVariants = normalizeSearchValue(options.searchQuery);
      const targetCategory = options.category || options.attribute;
      const targetAuthor = options.author || options.creator;
      const createSelectedList = (
        values: string[] | undefined,
        singleValue: string | undefined,
      ) =>
        (values && values.length > 0
          ? values
          : singleValue && singleValue !== "all"
            ? [singleValue]
            : []
        )
          .map((item) => item.trim())
          .filter(Boolean);

      const selectedAuthors = createSelectedList(options.authors, targetAuthor);
      const selectedCategories = createSelectedList(
        options.categories,
        targetCategory,
      );
      const categoryMatchMode =
        options.categoryMatchMode === "and" ? "and" : "or";

      let filtered = [...data];

      // Filter by entry type (avatar / world)
      if (options.entryTypeFilter) {
        filtered = filtered.filter(
          (akyo) => resolveEntryType(akyo) === options.entryTypeFilter,
        );
      }

      // Filter by categories (supports both single and multi-select)
      if (selectedCategories.length > 0) {
        filtered = filtered.filter((akyo) => {
          const parsedCategories =
            akyo.parsedCategory ??
            parseMultiValueField(akyo.category || akyo.attribute || "");

          if (categoryMatchMode === "and") {
            return selectedCategories.every((category) =>
              parsedCategories.includes(category),
            );
          }
          return selectedCategories.some((category) =>
            parsedCategories.includes(category),
          );
        });
      }

      // Filter by creator/author
      if (selectedAuthors.length > 0) {
        filtered = filtered.filter((akyo) => {
          const parsedAuthors =
            akyo.parsedAuthor ??
            parseMultiValueField(akyo.author || akyo.creator || "");
          return selectedAuthors.some((author) =>
            parsedAuthors.includes(author),
          );
        });
      }

      // Filter by favorites
      if (options.favoritesOnly) {
        filtered = filtered.filter((akyo) => akyo.isFavorite);
      }

      // Filter by search query (using pre-computed _searchIndex for performance)
      if (normalizedQueryVariants.length > 0) {
        filtered = filtered.filter((akyo) => {
          const normalizedTargets = akyo._searchIndex ?? buildSearchIndex(akyo);

          return normalizedQueryVariants.some((query) =>
            normalizedTargets.some((target) => target.includes(query)),
          );
        });
      }

      // Random display mode
      if (options.randomCount) {
        filtered = filtered
          .map((value) => ({ value, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ value }) => value)
          .slice(0, options.randomCount);
      } else {
        // Sort by display serial for worlds, by ID for avatars
        filtered.sort((a, b) => {
          const serialA = getDisplaySerialNumber(a);
          const serialB = getDisplaySerialNumber(b);
          const idA = serialA ?? (Number.parseInt(a.id, 10) || 0);
          const idB = serialB ?? (Number.parseInt(b.id, 10) || 0);
          return sortAsc ? idA - idB : idB - idA;
        });
      }

      filteredDataRef.current = filtered;
      setFilteredData(filtered);
    },
    [data],
  );

  // お気に入り機能
  const toggleFavorite = useCallback((id: string) => {
    const currentData = dataRef.current;
    const currentTarget = currentData.find((akyo) => akyo.id === id);
    if (!currentTarget) return;

    const persistedFavorites = getFavorites();
    favoriteOverridesRef.current = reconcileFavoriteOverride({
      persistedFavoriteIds: persistedFavorites,
      overrides: favoriteOverridesRef.current,
      id,
      nextIsFavorite: !Boolean(currentTarget.isFavorite),
    });

    favoritesDirtyRef.current =
      Object.keys(favoriteOverridesRef.current).length > 0;

    const effectiveFavorites = applyFavoriteOverrides(
      persistedFavorites,
      favoriteOverridesRef.current,
    );
    const { nextData, nextFilteredData } = syncFavoriteCollections({
      data: currentData,
      filteredData: filteredDataRef.current,
      favoriteIds: effectiveFavorites,
    });
    dataRef.current = nextData;
    filteredDataRef.current = nextFilteredData;
    setData(nextData);
    setFilteredData(nextFilteredData);
  }, []);

  return {
    data,
    filteredData,
    loading,
    error,
    filterData,
    toggleFavorite,
    refetchWithNewData,
    setLoading,
    setError,
  };
}

/**
 * localStorage キャッシュ (React Best Practices 7.5)
 * localStorage の読み書きは同期的で高コストなため、メモリ内にキャッシュして
 * 頻繁なアクセス時のパフォーマンスを改善
 */
let favoritesCache: string[] | null = null;

function invalidateFavoritesCache(): void {
  favoritesCache = null;
}

/**
 * お気に入りIDを取得（キャッシュ対応）
 */
function getFavorites(): string[] {
  if (favoritesCache !== null) return favoritesCache;
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!stored) {
      favoritesCache = [];
      return [];
    }
    const parsed: unknown = JSON.parse(stored);
    // バリデーション: 配列かつ全要素が文字列であることを確認
    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === "string")
    ) {
      favoritesCache = normalizeFavoriteIds(parsed);
      return favoritesCache;
    }
    // 不正なデータ形式の場合はリセット
    console.warn("Invalid favorites data in localStorage, resetting");
    favoritesCache = [];
    return [];
  } catch {
    favoritesCache = [];
    return [];
  }
}

/**
 * お気に入りIDを保存（キャッシュも同時に更新）
 */
function saveFavorites(ids: string[]): boolean {
  const idsCopy = normalizeFavoriteIds(ids);
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(idsCopy));
    favoritesCache = idsCopy;
    return true;
  } catch (e) {
    invalidateFavoritesCache();
    console.warn("Failed to save favorites to localStorage:", e);
    return false;
  }
}

/**
 * データ配列にお気に入り情報を付与する共通ヘルパー
 * Set を使用して O(1) ルックアップを実現 (React Best Practices 7.11)
 */
function applyFavorites(items: AkyoData[]): AkyoData[] {
  return applyFavoritesFromIds(items, getFavorites());
}

function applyFavoritesFromIds(
  items: AkyoData[],
  favoriteIds: readonly string[],
): AkyoData[] {
  if (items.length === 0) return items;
  const favoritesSet = new Set(normalizeFavoriteIds(favoriteIds));
  return items.map((akyo) => ({
    ...akyo,
    parsedCategory:
      akyo.parsedCategory ??
      parseMultiValueField(akyo.category || akyo.attribute || ""),
    parsedAuthor:
      akyo.parsedAuthor ??
      parseMultiValueField(akyo.author || akyo.creator || ""),
    _searchIndex: akyo._searchIndex ?? buildSearchIndex(akyo),
    isFavorite: favoritesSet.has(akyo.id),
  }));
}

export function syncFavoriteCollections<T extends { id: string; isFavorite?: boolean }>(
  args: {
    data: readonly T[];
    filteredData: readonly T[];
    favoriteIds: readonly string[];
  },
): {
  nextData: T[];
  nextFilteredData: T[];
} {
  const { data, filteredData, favoriteIds } = args;
  const favoritesSet = new Set(normalizeFavoriteIds(favoriteIds));
  const applyFavoriteFlags = (items: readonly T[]) =>
    items.map((item) => ({
      ...item,
      isFavorite: favoritesSet.has(item.id),
    }));

  return {
    nextData: applyFavoriteFlags(data),
    nextFilteredData: applyFavoriteFlags(filteredData),
  };
}

function normalizeFavoriteIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function getNextFavoritePersistRetryDelayMs(
  previousDelayMs: number | null,
): number {
  if (previousDelayMs === null) {
    return FAVORITE_PERSIST_RETRY_BASE_DELAY_MS;
  }

  return Math.min(
    previousDelayMs * 2,
    FAVORITE_PERSIST_RETRY_MAX_DELAY_MS,
  );
}

export function applyFavoriteOverrides(
  persistedFavoriteIds: readonly string[],
  overrides: FavoriteOverrides,
): string[] {
  const nextFavorites = new Set(normalizeFavoriteIds(persistedFavoriteIds));
  for (const [id, isFavorite] of Object.entries(overrides)) {
    if (isFavorite) {
      nextFavorites.add(id);
    } else {
      nextFavorites.delete(id);
    }
  }
  return normalizeFavoriteIds(Array.from(nextFavorites));
}

export function pruneFavoriteOverrides(
  persistedFavoriteIds: readonly string[],
  overrides: FavoriteOverrides,
): FavoriteOverrides {
  const persistedFavorites = new Set(normalizeFavoriteIds(persistedFavoriteIds));
  return Object.fromEntries(
    Object.entries(overrides).filter(
      ([id, isFavorite]) => persistedFavorites.has(id) !== isFavorite,
    ),
  );
}

export function reconcileFavoriteOverride(args: {
  persistedFavoriteIds: readonly string[];
  overrides: FavoriteOverrides;
  id: string;
  nextIsFavorite: boolean;
}): FavoriteOverrides {
  const { persistedFavoriteIds, overrides, id, nextIsFavorite } = args;
  const nextOverrides = { ...overrides };
  const persistedFavorites = new Set(normalizeFavoriteIds(persistedFavoriteIds));

  if (persistedFavorites.has(id) === nextIsFavorite) {
    delete nextOverrides[id];
  } else {
    nextOverrides[id] = nextIsFavorite;
  }

  return pruneFavoriteOverrides(persistedFavoriteIds, nextOverrides);
}

function parseMultiValueField(value: string): string[] {
  return value
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
