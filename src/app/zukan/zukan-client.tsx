"use client";

/**
 * Zukan Client Component
 *
 * Handles all client-side interactivity:
 * - Search and filtering
 * - View mode switching (grid/list)
 * - Favorites (localStorage)
 * - Sort and random display
 * - Virtual scrolling (performance optimization)
 */

import {
  AkyoCard,
  shouldPrioritizeCatalogCardImage,
} from "@/components/akyo-card";
import { AkyoList } from "@/components/akyo-list";
import { DeferredAkyoDetailModal } from "@/components/deferred-akyo-detail-modal";
import {
  IconCog,
  IconGlobe,
  IconGrid,
  IconHeart,
  IconList,
  IconShoppingBag,
} from "@/components/icons";
import { SortControls } from "@/components/sort-controls";
import { LanguageToggle } from "@/components/language-toggle";
import { SearchBar } from "@/components/search-bar";
import {
  createLanguageDatasetCacheEntry,
  resolveImmediateLanguageDataset,
  type LanguageDatasetCacheEntry,
} from "./language-dataset-state";
import {
  CatalogRequestCoordinator,
  loadCompleteCatalogData,
} from "./catalog-data-loader";
import {
  CatalogLoadPerformance,
  reportCatalogLoadToSentry,
} from "./catalog-performance";
import { prepareCatalogItemsInChunks } from "@/lib/catalog-preparation";
import {
  sortCatalogForDisplay,
  summarizeCatalog,
  type CatalogTotals,
} from "./catalog-initial-data";
import { resolveClientCatalogUrl } from "./catalog-language";
import {
  getNextFilterPanelOpenState,
  resolveFilterPanelOpenState,
} from "./filter-panel-state";
import { useAkyoData } from "@/hooks/use-akyo-data";
import { useLanguage } from "@/hooks/use-language";
import { t, type SupportedLanguage } from "@/lib/i18n";
import type { AkyoData, AkyoEntryType, ViewMode } from "@/types/akyo";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ZukanClientProps {
  initialData: AkyoData[];
  initialTotals: CatalogTotals;
  initialDataComplete: boolean;
  catalogUrl: string;
  sharedEntryId?: string;

  // 新フィールド
  categories: string[];
  authors: string[];

  // 旧フィールド（非推奨）
  /** @deprecated use categories */
  attributes: string[];
  /** @deprecated use authors */
  creators: string[];

  /** Server-rendered language (for static generation) */
  serverLang: SupportedLanguage;
}

const LOGO_BY_LANG: Record<SupportedLanguage | "default", string> = {
  ja: "/images/logo-mobile.webp",
  en: "/images/logo-US-mobile.webp",
  ko: "/images/logo-KO-mobile.webp",
  default: "/images/logo-US-mobile.webp",
};
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;
const DEFAULT_R2_BASE_URL = "https://images.akyodex.com";

const DeferredMiniAkyoBg = dynamic(
  () => import("@/components/mini-akyo-bg").then((mod) => mod.MiniAkyoBg),
  { ssr: false },
);
const DeferredFilterPanel = dynamic(
  () => import("@/components/filter-panel").then((mod) => mod.FilterPanel),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-[755px] items-center justify-center text-sm text-[var(--text-secondary)] lg:min-h-[403px]"
        role="status"
      >
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600" />
      </div>
    ),
  },
);

// Virtual scrolling constants
const MOBILE_BREAKPOINT = 768;
const DESKTOP_RENDER_LIMIT = 20;
const MOBILE_RENDER_LIMIT = 12;
const RENDER_CHUNK = 30;
const MINI_AKYO_BG_DELAY_MS = 2500;

function useResponsiveLayout() {
  // SSR-intentional behavior: isMobile is undefined during SSR/initial render
  // to avoid mismatched HTML. Visual stability is maintained by CSS (aspect ratio).
  // The actual device width is determined on client mount.
  const [layout, setLayout] = useState<{
    isMobile: boolean | undefined;
    gridCols: number;
  }>({
    isMobile: undefined,
    gridCols: 1,
  });

  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      const mobile = w < MOBILE_BREAKPOINT;

      let cols: number;
      if (w >= 1024) {
        cols = 5;
      } else if (w >= 768) {
        cols = 3;
      } else if (w >= 640) {
        cols = 2;
      } else {
        cols = 1;
      }

      setLayout({
        isMobile: mobile,
        gridCols: cols,
      });
    };
    handler();

    let timeoutId: number;
    const debouncedHandler = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handler, 150);
    };

    window.addEventListener("resize", debouncedHandler);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", debouncedHandler);
    };
  }, []);

  return layout;
}

function extractTaxonomy(
  akyoItems: AkyoData[],
): Pick<LanguageDatasetCacheEntry, "categories" | "authors"> {
  const uniqueCategories = new Set<string>();
  const uniqueAuthors = new Set<string>();

  for (const item of akyoItems) {
    const cats = (item.category || item.attribute || "")
      .split(MULTI_VALUE_SPLIT_PATTERN)
      .map((s) => s.trim())
      .filter(Boolean);
    const auths = (item.author || item.creator || "")
      .split(MULTI_VALUE_SPLIT_PATTERN)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const category of cats) {
      uniqueCategories.add(category);
    }
    for (const author of auths) {
      uniqueAuthors.add(author);
    }
  }

  return {
    categories: Array.from(uniqueCategories).sort(),
    authors: Array.from(uniqueAuthors).sort(),
  };
}

export function ZukanClient({
  initialData,
  initialTotals,
  initialDataComplete,
  catalogUrl,
  sharedEntryId,
  categories,
  authors,
  attributes,
  creators,
  serverLang,
}: ZukanClientProps) {
  // Client-side language detection
  const { lang, isReady } = useLanguage(serverLang);

  const {
    data,
    filteredData,
    error,
    loading,
    filterData,
    toggleFavorite,
    refetchWithNewData,
    setLoading,
    setError,
  } = useAkyoData(initialData);
  const serverDataset = useMemo(
    () =>
      createLanguageDatasetCacheEntry({
        items: initialData,
        categories,
        authors,
        complete: initialDataComplete,
      }),
    [initialData, categories, authors, initialDataComplete],
  );

  // — State —
  const [currentCategories, setCurrentCategories] = useState(categories);
  const [currentAuthors, setCurrentAuthors] = useState(authors);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [categoryMatchMode, setCategoryMatchMode] = useState<"or" | "and">(
    "or",
  );
  const [selectedCreators, setSelectedCreators] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortAscending, setSortAscending] = useState(true);
  const [randomMode, setRandomMode] = useState(false);
  const [entryTypeFilter, setEntryTypeFilter] = useState<
    AkyoEntryType | undefined
  >(undefined);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean | null>(
    null,
  );
  const [selectedAkyo, setSelectedAkyo] = useState<AkyoData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shouldRenderDetailModal, setShouldRenderDetailModal] = useState(false);
  const [renderLimit, setRenderLimit] = useState(MOBILE_RENDER_LIMIT);
  const { isMobile, gridCols } = useResponsiveLayout();
  const [isMiniAkyoBgEnabled, setIsMiniAkyoBgEnabled] = useState(false);
  const [refetchError, setRefetchError] = useState<string | null>(null);
  const [isCurrentDatasetComplete, setIsCurrentDatasetComplete] = useState(
    initialDataComplete,
  );
  const [droppedCatalogEntryCount, setDroppedCatalogEntryCount] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);

  const languageDatasetCacheRef = useRef<
    Map<SupportedLanguage, LanguageDatasetCacheEntry>
  >(new Map([[serverLang, serverDataset]]));
  const requestCoordinatorRef = useRef<CatalogRequestCoordinator | null>(null);
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = new CatalogRequestCoordinator();
  }
  const tickingRef = useRef(false);
  const filteredLengthRef = useRef(0);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);
  const sharedEntryHandledRef = useRef(false);
  const catalogPerformanceRef = useRef<CatalogLoadPerformance | null>(null);

  // — Derived values —
  const stats = useMemo(() => {
    const loadedSummary = summarizeCatalog(data);
    const totalSummary = isCurrentDatasetComplete
      ? loadedSummary
      : initialTotals;
    const displayedSummary = summarizeCatalog(filteredData);

    return {
      totalEntries: totalSummary.entries,
      totalAvatars: totalSummary.avatars,
      totalWorlds: totalSummary.worlds,
      totalProducts: totalSummary.products,
      displayedEntries: displayedSummary.entries,
      displayedAvatars: displayedSummary.avatars,
      displayedWorlds: displayedSummary.worlds,
      displayedProducts: displayedSummary.products,
      favorites: loadedSummary.favorites,
    };
  }, [data, filteredData, initialTotals, isCurrentDatasetComplete]);
  const displayedBreakdownText = t("stats.displayedBreakdown", lang)
    .replace("{count}", String(stats.displayedEntries))
    .replace("{avatars}", String(stats.displayedAvatars))
    .replace("{worlds}", String(stats.displayedWorlds))
    .replace("{products}", String(stats.displayedProducts));
  const displayedBreakdownPlaceholder = t("stats.displayedBreakdown", lang)
    .replace("{count}", String(initialTotals.entries))
    .replace("{avatars}", String(initialTotals.avatars))
    .replace("{worlds}", String(initialTotals.worlds))
    .replace("{products}", String(initialTotals.products));
  const canShowDisplayedBreakdown = isCurrentDatasetComplete;

  const activeFilterCount = useMemo(
    () =>
      selectedAttributes.length +
      selectedCreators.length +
      (favoritesOnly ? 1 : 0) +
      (entryTypeFilter ? 1 : 0),
    [selectedAttributes, selectedCreators, favoritesOnly, entryTypeFilter],
  );
  const catalogControlsDisabled = !isCurrentDatasetComplete;
  const languageStatusMessage = refetchError
    ? refetchError
    : catalogControlsDisabled
      ? t("loading.catalog", lang)
      : droppedCatalogEntryCount > 0
        ? t("warning.catalogEntriesDropped", lang).replace(
            "{count}",
            String(droppedCatalogEntryCount),
          )
        : null;
  const catalogStatusAnnouncement =
    languageStatusMessage ?? t("loading.catalogComplete", lang);
  const resolvedIsFilterPanelOpen = resolveFilterPanelOpenState({
    isFilterPanelOpen,
    isMobile,
  });

  // Sync the server payload without replacing a completed in-memory dataset.
  useEffect(() => {
    const cachedDataset = languageDatasetCacheRef.current.get(serverLang);
    if (!cachedDataset?.complete) {
      languageDatasetCacheRef.current.set(serverLang, serverDataset);
    }
  }, [serverLang, serverDataset]);

  useEffect(() => {
    if (isMobile === undefined) return;
    setIsFilterPanelOpen((current) => {
      if (current !== null) return current;
      return resolveFilterPanelOpenState({
        isFilterPanelOpen: current,
        isMobile,
      });
    });
  }, [isMobile]);

  // Start loading the complete catalog as soon as the client is hydrated.
  useEffect(() => {
    if (!isReady) return;

    const immediateDataset = resolveImmediateLanguageDataset({
      lang,
      serverLang,
      cachedDataset: languageDatasetCacheRef.current.get(lang),
      serverDataset,
    });
    if (immediateDataset?.complete) {
      catalogPerformanceRef.current = null;
      refetchWithNewData(immediateDataset.items);
      setCurrentCategories(immediateDataset.categories);
      setCurrentAuthors(immediateDataset.authors);
      setIsCurrentDatasetComplete(true);
      setDroppedCatalogEntryCount(immediateDataset.droppedCount);
      setRefetchError(null);
      setError(null);
      setLoading(false);
      return;
    }

    setIsCurrentDatasetComplete(false);
    setLoading(true);
    setError(null);
    setRefetchError(null);
    setDroppedCatalogEntryCount(0);

    const coordinator = requestCoordinatorRef.current;
    if (!coordinator) return;
    const request = coordinator.begin();
    const catalogPerformance = new CatalogLoadPerformance(lang);
    catalogPerformanceRef.current = catalogPerformance;

    const fetchCompleteData = async () => {
      try {
        const result = await loadCompleteCatalogData({
          lang,
          catalogUrl: resolveClientCatalogUrl(catalogUrl, serverLang, lang),
          r2BaseUrl:
            process.env.NEXT_PUBLIC_R2_BASE || DEFAULT_R2_BASE_URL,
          signal: request.signal,
          phaseRecorder: catalogPerformance,
        });
        if (!coordinator.isCurrent(request.generation)) return;
        catalogPerformance.markResponse(result.source);

        catalogPerformance.startPhase("search-index");
        let preparedItems: AkyoData[];
        try {
          preparedItems = sortCatalogForDisplay(
            await prepareCatalogItemsInChunks(result.items, {
              signal: request.signal,
            }),
          );
        } finally {
          catalogPerformance.endPhase("search-index");
        }
        if (!coordinator.isCurrent(request.generation)) return;

        const taxonomy = extractTaxonomy(preparedItems);
        const completedDataset = createLanguageDatasetCacheEntry({
          items: preparedItems,
          categories: taxonomy.categories,
          authors: taxonomy.authors,
          complete: true,
          droppedCount: result.droppedCount,
        });
        languageDatasetCacheRef.current.set(lang, completedDataset);
        catalogPerformance.startPhase("state-apply");
        startTransition(() => {
          refetchWithNewData(completedDataset.items);
          setCurrentCategories(taxonomy.categories);
          setCurrentAuthors(taxonomy.authors);
          setSelectedAttributes([]);
          setSelectedCreators([]);
          setIsCurrentDatasetComplete(true);
          setDroppedCatalogEntryCount(result.droppedCount);
          setRefetchError(null);
          setError(null);
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!coordinator.isCurrent(request.generation)) return;
        const telemetry = catalogPerformance.markFailure(err);
        if (telemetry) void reportCatalogLoadToSentry(telemetry);
        if (catalogPerformanceRef.current === catalogPerformance) {
          catalogPerformanceRef.current = null;
        }
        console.error("[ZukanClient] Failed to load complete catalog:", err);
        setRefetchError(t("error.catalogUnavailable", lang));
      } finally {
        if (coordinator.isCurrent(request.generation)) {
          setLoading(false);
        }
      }
    };

    void fetchCompleteData();
    return () => {
      if (coordinator.isCurrent(request.generation)) {
        coordinator.cancel();
      }
    };
  }, [
    isReady,
    lang,
    catalogUrl,
    serverLang,
    serverDataset,
    retryNonce,
    refetchWithNewData,
    setLoading,
    setError,
  ]);

  useEffect(() => {
    if (!isCurrentDatasetComplete) return;
    const catalogPerformance = catalogPerformanceRef.current;
    if (!catalogPerformance) return;

    catalogPerformance.endPhase("state-apply");
    const telemetry = catalogPerformance.markReady();
    catalogPerformanceRef.current = null;
    if (telemetry) void reportCatalogLoadToSentry(telemetry);
  }, [isCurrentDatasetComplete]);

  // Initial mount optimizations: responsive render limit and defer heavy bg
  useEffect(() => {
    // Delay or disable MiniAkyoBg depending on device
    // Consider it disabled completely on mobile to save CPU rendering.
    let timer: number | undefined;
    if (!isMobile) {
      timer = window.setTimeout(() => {
        setIsMiniAkyoBgEnabled(true);
      }, MINI_AKYO_BG_DELAY_MS);
    } else {
      setIsMiniAkyoBgEnabled(false);
    }

    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [isMobile]);

  const handleShowDetail = useCallback(
    (
      akyo: AkyoData,
      triggerElement: HTMLElement | null = document.activeElement as HTMLElement | null,
    ) => {
      modalTriggerRef.current = triggerElement;
      setShouldRenderDetailModal(true);
      setSelectedAkyo(akyo);
      setIsModalOpen(true);
    },
    [],
  );

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAkyo(null);
  };

  useEffect(() => {
    if (!sharedEntryId || sharedEntryHandledRef.current) return;
    const sharedEntry = data.find((item) => item.id === sharedEntryId);
    if (!sharedEntry) {
      if (isCurrentDatasetComplete) sharedEntryHandledRef.current = true;
      return;
    }

    sharedEntryHandledRef.current = true;
    modalTriggerRef.current = mainContentRef.current;
    setShouldRenderDetailModal(true);
    setSelectedAkyo(sharedEntry);
    setIsModalOpen(true);
  }, [data, isCurrentDatasetComplete, sharedEntryId]);

  const handleModalFavoriteToggle = (id: string) => {
    toggleFavorite(id);
    // Optimistically update modal state and let data-sync effect reconcile with source data.
    setSelectedAkyo((prev) =>
      prev && prev.id === id ? { ...prev, isFavorite: !prev.isFavorite } : prev,
    );
  };

  // data が更新された際（cross-tab sync 等）、モーダルが開いていれば selectedAkyo を最新に同期
  useEffect(() => {
    if (!isModalOpen) return;
    setSelectedAkyo((prev) => {
      if (!prev) return prev;
      const latest = data.find((a) => a.id === prev.id);
      if (latest && latest !== prev) return latest;
      return prev;
    });
  }, [data, isModalOpen]);

  useEffect(() => {
    setRenderLimit(
      isMobile === false ? DESKTOP_RENDER_LIMIT : MOBILE_RENDER_LIMIT,
    );
  }, [
    searchQuery,
    selectedAttributes,
    categoryMatchMode,
    selectedCreators,
    favoritesOnly,
    sortAscending,
    randomMode,
    isMobile,
  ]);

  // Keep filteredData.length in a ref so handleScroll stays stable
  useEffect(() => {
    filteredLengthRef.current = filteredData.length;
  }, [filteredData.length]);

  // Virtual scrolling: Infinite scroll handler (stable — no state/derived deps)
  const handleScroll = useCallback(() => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    requestAnimationFrame(() => {
      const nearBottom =
        window.innerHeight + window.scrollY >
        document.documentElement.scrollHeight - 800;
      if (nearBottom) {
        const len = filteredLengthRef.current;
        setRenderLimit((prev) =>
          prev < len ? Math.min(len, prev + RENDER_CHUNK) : prev,
        );
      }
      tickingRef.current = false;
    });
  }, []);

  // Attach scroll listener (runs once thanks to stable handleScroll)
  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // フィルター適用
  useEffect(() => {
    if (!isCurrentDatasetComplete) return;

    if (randomMode) {
      // ランダム表示中はエントリ種別フィルターのみ反映して再シャッフル
      filterData(
        {
          searchQuery: "",
          randomCount: 20,
          entryTypeFilter,
        },
        sortAscending,
      );
      return;
    }
    filterData(
      {
        searchQuery,
        categories:
          selectedAttributes.length > 0 ? selectedAttributes : undefined,
        authors: selectedCreators.length > 0 ? selectedCreators : undefined,
        categoryMatchMode,
        // 新フィールド名を優先して渡す
        category: selectedAttributes[0] || undefined,
        author: selectedCreators[0] || undefined,
        // 旧フィールド名も念のため渡す
        attribute: selectedAttributes[0] || undefined,
        creator: selectedCreators[0] || undefined,
        favoritesOnly,
        entryTypeFilter,
      },
      sortAscending,
    );
  }, [
    searchQuery,
    selectedAttributes,
    categoryMatchMode,
    selectedCreators,
    favoritesOnly,
    sortAscending,
    randomMode,
    entryTypeFilter,
    filterData,
    isCurrentDatasetComplete,
  ]);

  // ソート切替
  const handleSortToggle = () => {
    setSortAscending((prev) => !prev);
  };

  // ランダム表示
  const handleRandomClick = () => {
    if (randomMode) {
      setRandomMode(false);
    } else {
      setRandomMode(true);
      // エントリ種別フィルターは維持し、他のフィルタ状態をリセット
      setSearchQuery("");
      setSelectedAttributes([]);
      setCategoryMatchMode("or");
      setSelectedCreators([]);
      setFavoritesOnly(false);
      filterData(
        {
          searchQuery: "",
          randomCount: 20,
          entryTypeFilter,
        },
        sortAscending,
      );
    }
  };

  // エントリ種別フィルター切替（トグル: 同じボタンを再度押すと解除）
  const handleEntryTypeFilterClick = (type: AkyoEntryType) => {
    setEntryTypeFilter((prev) => (prev === type ? undefined : type));
  };

  // BOOTH商品フィルター切替（Boothカテゴリのトグル）
  const isBoothFilterActive = selectedAttributes.includes("Booth");
  const handleBoothFilterClick = () => {
    setSelectedAttributes((prev) =>
      prev.includes("Booth")
        ? prev.filter((a) => a !== "Booth")
        : [...prev, "Booth"],
    );
  };

  // お気に入りフィルター切替
  const handleFavoritesClick = () => {
    setFavoritesOnly((prev) => !prev);
  };

  const handleSkipToContent = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.history.replaceState(null, "", "#main-content");
    mainContentRef.current?.focus();
    mainContentRef.current?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="akyo-card-static p-8 text-center space-y-4">
          <div className="text-6xl" aria-hidden="true">😢</div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("error.title", lang)}
          </h2>
          <p className="text-[var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  // Fallback only when we have no data to keep rendering.
  if (loading && data.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="akyo-card-static p-8 text-center space-y-4 animate-pulse">
          <div className="text-6xl" aria-hidden="true">🔄</div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("loading.text", lang)}
          </h2>
          <p className="text-[var(--text-secondary)]">
            {t("loading.subtext", lang)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16 relative">
      {/* Mini Akyo Background Animation */}
      {isMiniAkyoBgEnabled ? <DeferredMiniAkyoBg /> : null}

      <a
        href="#main-content"
        onClick={handleSkipToContent}
        className="absolute left-4 top-4 z-[120] -translate-y-[200%] rounded-xl bg-white px-4 py-3 text-sm font-bold text-[var(--text-primary)] shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-4 focus:ring-orange-300"
      >
        {t("skip.mainContent", lang)}
      </a>

      {/* ヘッダー */}
      <header className="sticky top-0 z-50 p-4 sm:p-6">
        <nav
          aria-label={t("nav.primary", lang)}
          className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4"
        >
          {/* ロゴ */}
          <Link href="/" className="flex-shrink-0">
            <Image
              src={LOGO_BY_LANG[lang] || LOGO_BY_LANG.default}
              alt={t("logo.alt", lang)}
              width={454}
              height={70}
              unoptimized
              priority
              fetchPriority="high"
              sizes="(max-width: 640px) 260px, (max-width: 1024px) 420px, 454px"
              className="logo-animation h-10 sm:h-12 w-auto"
            />
          </Link>

          {/* 統計情報 */}
          <dl className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-4 text-sm sm:text-base font-bold text-white w-full sm:w-auto">
            <div className="min-w-0 bg-white/20 backdrop-blur-sm px-3 py-1.5 sm:py-2 rounded-2xl sm:rounded-full flex items-center gap-1 sm:gap-2">
              <dt className="text-xs sm:text-sm text-white/90 whitespace-nowrap">{t("stats.totalLabel", lang)}：</dt>
              <dd className="min-w-0 text-xs leading-snug whitespace-normal sm:text-base sm:whitespace-nowrap">
                {t("stats.totalBreakdown", lang)
                  .replace("{count}", String(stats.totalEntries))
                  .replace("{avatars}", String(stats.totalAvatars))
                  .replace("{worlds}", String(stats.totalWorlds))
                  .replace("{products}", String(stats.totalProducts))}
              </dd>
            </div>
            <div className="min-w-0 bg-white/20 backdrop-blur-sm px-3 py-1.5 sm:py-2 rounded-2xl sm:rounded-full flex items-center gap-1 sm:gap-2">
              <dt className="text-xs sm:text-sm text-white/90 whitespace-nowrap">{t("stats.displayedLabel", lang)}：</dt>
              <dd className="min-w-0 text-xs leading-snug whitespace-normal sm:text-base sm:whitespace-nowrap">
                {canShowDisplayedBreakdown
                  ? displayedBreakdownText
                  : (
                      <span className="relative block">
                        <span aria-hidden="true" className="invisible block">
                          {displayedBreakdownPlaceholder}
                        </span>
                        <span className="absolute inset-0">
                          {t("stats.displayedLoading", lang)}
                        </span>
                      </span>
                    )}
              </dd>
            </div>
            <div className="min-w-0 bg-white/20 backdrop-blur-sm px-3 py-1.5 sm:py-2 rounded-2xl sm:rounded-full flex items-center gap-1 sm:gap-2">
              <dt className="text-xs sm:text-sm text-white/90 whitespace-nowrap">{t("stats.favoritesLabel", lang)}：</dt>
              <dd className="min-w-[5ch] text-xs leading-snug whitespace-normal sm:text-base sm:whitespace-nowrap flex items-center gap-1">
                {/* OSの絵文字ハートは3D調で浮くため、白塗りのフラットなSVGに統一。
                    サイズは1em(フォント連動)、translate-y-0.05emは数字グリフの
                    インク中心とハート中心を一致させる視覚補正（フォントメトリクス実測値） */}
                <IconHeart
                  size="w-[1em] h-[1em]"
                  className="inline-block shrink-0 translate-y-[0.05em]"
                  aria-hidden="true"
                />
                {isCurrentDatasetComplete ? (
                  stats.favorites
                ) : (
                  <>
                    <span aria-hidden="true">…</span>
                    <span className="sr-only">
                      {t("stats.favoritesLoading", lang)}
                    </span>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </nav>
      </header>

      <div
        id="catalog-status-announcement"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {catalogStatusAnnouncement}
      </div>

      {languageStatusMessage ? (
        <div className="fixed bottom-4 left-4 right-24 z-[80] sm:left-auto sm:right-6 sm:w-[420px]">
          <div
            className={`flex flex-col items-stretch justify-between gap-3 rounded-xl px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center ${
              refetchError || droppedCatalogEntryCount > 0
                ? "border border-amber-300 bg-amber-50/95 text-amber-900"
                : "border border-sky-300 bg-sky-50/95 text-sky-900"
            }`}
          >
            <div>{languageStatusMessage}</div>
            {refetchError ? (
              <button
                type="button"
                onClick={() => setRetryNonce((current) => current + 1)}
                className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold text-amber-950 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                aria-label={t("loading.retry", lang)}
              >
                {t("loading.retry", lang)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* メインコンテンツ */}
      <main
        id="main-content"
        ref={mainContentRef}
        tabIndex={-1}
        className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6 relative z-10 focus:outline-none"
      >
        <h1 className="sr-only">{t("page.title", lang)}</h1>

        {/* 検索バー */}
        <div className="akyo-card-static p-4 sm:p-6">
          <SearchBar
            onSearch={setSearchQuery}
            value={searchQuery}
            placeholder={t("search.placeholder", lang)}
            ariaLabel={t("search.ariaLabel", lang)}
            clearAriaLabel={t("search.clearAriaLabel", lang)}
            disabled={catalogControlsDisabled}
          />
        </div>

        {/* フィルターとビュー切替 */}
        <div
          className="akyo-card-static p-4 sm:p-6 space-y-4"
          aria-busy={catalogControlsDisabled}
        >
          <div className="space-y-2">
            <button
              type="button"
              onClick={() =>
                setIsFilterPanelOpen((current) =>
                  getNextFilterPanelOpenState({
                    current,
                    isMobile,
                  }),
                )
              }
              aria-expanded={resolvedIsFilterPanelOpen}
              aria-controls="zukan-filter-panel"
              disabled={catalogControlsDisabled}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-[var(--text-primary)] shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
            >
              {resolvedIsFilterPanelOpen
                ? t("filter.panelHide", lang)
                : t("filter.panelShow", lang)}
            </button>
            {!resolvedIsFilterPanelOpen ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {t("filter.panelSummary", lang).replace(
                  "{count}",
                  String(activeFilterCount),
                )}
              </p>
            ) : null}
          </div>

          {/* 並び替え系はフィルタ閉時のみトグル直下に表示（モバイルの即アクセス用）。
              開時は従来どおりパネル下(下の同要素)に出す。SSR分岐はパネルと同じ
              CSSメディア境界でCLSを防ぐ */}
          <div
            className={
              isMobile === undefined
                ? "md:hidden"
                : resolvedIsFilterPanelOpen ? "hidden" : "block"
            }
          >
            <SortControls
              onSortToggle={handleSortToggle}
              onRandomClick={handleRandomClick}
              onFavoritesClick={handleFavoritesClick}
              favoritesOnly={favoritesOnly}
              sortAscending={sortAscending}
              randomMode={randomMode}
              lang={lang}
              disabled={catalogControlsDisabled}
            />
          </div>

          <div
            id="zukan-filter-panel"
            className={
              isMobile === undefined
                ? "hidden md:block" // SSR: CSS media query prevents CLS on mobile
                : resolvedIsFilterPanelOpen ? "block" : "hidden"
            }
          >
            {isCurrentDatasetComplete ? (
              <DeferredFilterPanel
                // 動的に更新されるカテゴリ/作者を使用
                categories={currentCategories}
                authors={currentAuthors}
                // TODO: Remove legacy props once FilterPanel fully drops attribute/creator support.
                attributes={currentCategories}
                creators={currentAuthors}
                selectedAttributes={selectedAttributes}
                selectedCreators={selectedCreators}
                categoryMatchMode={categoryMatchMode}
                selectedCreator={selectedCreators[0] || ""}
                onAttributesChange={setSelectedAttributes}
                onCreatorsChange={setSelectedCreators}
                onCategoryMatchModeChange={setCategoryMatchMode}
                onCreatorChange={(creator) =>
                  setSelectedCreators(creator ? [creator] : [])
                }
                lang={lang}
                disabled={catalogControlsDisabled}
              />
            ) : (
              <fieldset
                disabled
                aria-busy="true"
                className="flex min-h-[755px] items-center justify-center lg:min-h-[403px]"
              >
                <legend className="sr-only">{t("loading.catalog", lang)}</legend>
                <span
                  className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
                  aria-hidden="true"
                />
              </fieldset>
            )}
          </div>

          {/* フィルタ開時の並び替え系（従来の公開版と同じ、絞り込みの下） */}
          <div
            className={
              isMobile === undefined
                ? "hidden md:block"
                : resolvedIsFilterPanelOpen ? "block" : "hidden"
            }
          >
            <SortControls
              onSortToggle={handleSortToggle}
              onRandomClick={handleRandomClick}
              onFavoritesClick={handleFavoritesClick}
              favoritesOnly={favoritesOnly}
              sortAscending={sortAscending}
              randomMode={randomMode}
              lang={lang}
              disabled={catalogControlsDisabled}
            />
          </div>

          {/* ビュー切替 & エントリ種別フィルター */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
              aria-label={t("view.card", lang)}
              aria-pressed={viewMode === "grid"}
            >
              <IconGrid size="w-5 h-5 md:w-6 md:h-6" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`view-toggle-btn ${viewMode === "list" ? "active" : ""}`}
              aria-label={t("view.list", lang)}
              aria-pressed={viewMode === "list"}
            >
              <IconList size="w-5 h-5 md:w-6 md:h-6" />
            </button>
            <button
              type="button"
              onClick={() => handleEntryTypeFilterClick("avatar")}
              className={`view-toggle-btn disabled:cursor-wait disabled:opacity-50 ${entryTypeFilter === "avatar" ? "active" : ""}`}
              aria-label={t("view.avatarsOnly", lang)}
              aria-pressed={entryTypeFilter === "avatar"}
              disabled={catalogControlsDisabled}
            >
              <Image
                src="/images/profileIcon.webp"
                alt=""
                width={24}
                height={24}
                className="w-5 h-5 md:w-6 md:h-6 rounded-full object-cover"
                unoptimized
              />
            </button>
            <button
              type="button"
              onClick={() => handleEntryTypeFilterClick("world")}
              className={`view-toggle-btn disabled:cursor-wait disabled:opacity-50 ${entryTypeFilter === "world" ? "active" : ""}`}
              aria-label={t("view.worldsOnly", lang)}
              aria-pressed={entryTypeFilter === "world"}
              disabled={catalogControlsDisabled}
            >
              <IconGlobe size="w-5 h-5 md:w-6 md:h-6" />
            </button>
            <button
              type="button"
              onClick={handleBoothFilterClick}
              className={`view-toggle-btn disabled:cursor-wait disabled:opacity-50 ${isBoothFilterActive ? "active" : ""}`}
              aria-label={t("view.boothOnly", lang)}
              aria-pressed={isBoothFilterActive}
              disabled={catalogControlsDisabled}
            >
              <IconShoppingBag size="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
        </div>

        {/* Akyoカード/リスト表示 */}
        {filteredData.length === 0 ? (
          <div className="akyo-card-static p-12 text-center space-y-4">
            <div className="text-6xl" aria-hidden="true">🔍</div>
            <h3 className="text-2xl font-bold text-[var(--text-primary)]">
              {t("notfound.title", lang)}
            </h3>
            <p className="text-[var(--text-secondary)]">
              {t("notfound.message", lang)}
            </p>
          </div>
        ) : viewMode === "list" ? (
          <AkyoList
            data={filteredData.slice(0, renderLimit)}
            lang={lang}
            onToggleFavorite={toggleFavorite}
            onShowDetail={handleShowDetail}
          />
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6"
            style={{
              minHeight:
                isMobile === false && filteredData.length > 0
                  ? // 420px card height + 24px gap = 444px per row
                    `${Math.ceil(Math.min(filteredData.length, DESKTOP_RENDER_LIMIT) / gridCols) * 444 - 24}px`
                  : undefined,
            }}
          >
            {filteredData.slice(0, renderLimit).map((akyo, index) => (
              <AkyoCard
                key={akyo.id}
                akyo={akyo}
                lang={lang}
                onToggleFavorite={toggleFavorite}
                onShowDetail={handleShowDetail}
                priority={shouldPrioritizeCatalogCardImage(index)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      {shouldRenderDetailModal ? (
        <DeferredAkyoDetailModal
          akyo={selectedAkyo}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onToggleFavorite={handleModalFavoriteToggle}
          lang={lang}
          returnFocusRef={modalTriggerRef}
        />
      ) : null}

      {/* Language Toggle Button - Top */}
      <LanguageToggle initialLang={lang} />

      {/* Admin Settings Button - Below Language Toggle (same color as Language Toggle) */}
      <Link
        href="/admin"
        className="admin-button group"
        aria-label={t("admin.panel", lang)}
        title={t("admin.panel", lang)}
      >
        <IconCog
          size="w-5 h-5 sm:w-6 sm:h-6"
          className="group-hover:rotate-90 transition-transform duration-300"
        />
      </Link>

      {/* AI Chat Assistant (Dify embed) */}
      <div
        id="dify-chatbot-container"
        className="fixed bottom-6 right-6 z-[2147483647]"
        role="complementary"
        aria-label={t("chatbot.ariaLabel", lang)}
      />
    </div>
  );
}
