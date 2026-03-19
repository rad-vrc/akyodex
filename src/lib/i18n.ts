/**
 * Internationalization (i18n) utilities
 *
 * Features:
 * - Auto-detect language from headers
 * - Manual language switching
 * - localStorage persistence
 */

export type SupportedLanguage = "ja" | "en" | "ko";

// Toggle order: ja → en → ko → ja
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["ja", "en", "ko"];

export const DEFAULT_LANGUAGE: SupportedLanguage = "ja";

/**
 * Language display names
 */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ja: "日本語",
  en: "English",
  ko: "한국어",
};

/**
 * Language toggle labels
 */
export const LANGUAGE_TOGGLE_LABELS: Record<SupportedLanguage, string> = {
  ja: "EN", // Shows "EN" when current is Japanese (next: English)
  en: "KO", // Shows "KO" when current is English (next: Korean)
  ko: "JA", // Shows "JA" when current is Korean (next: Japanese)
};

/**
 * Detect language from Accept-Language header
 *
 * Priority:
 * 1. Exact match (ja, en)
 * 2. Language prefix (ja-JP -> ja, en-US -> en)
 * 3. Default (ja)
 */
export function detectLanguageFromHeader(
  acceptLanguage: string | null,
): SupportedLanguage {
  if (!acceptLanguage) return DEFAULT_LANGUAGE;

  // Parse Accept-Language header
  // Format: "en-US,en;q=0.9,ja;q=0.8"
  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, qValue] = lang.split(";");
      const q = qValue ? parseFloat(qValue.replace("q=", "")) : 1.0;
      return { code: code.trim().toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q); // Sort by quality value (highest first)

  // Find first supported language
  for (const { code } of languages) {
    // Exact match
    if (SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)) {
      return code as SupportedLanguage;
    }

    // Prefix match (en-US -> en)
    const prefix = code.split("-")[0] as SupportedLanguage;
    if (SUPPORTED_LANGUAGES.includes(prefix)) {
      return prefix;
    }
  }

  return DEFAULT_LANGUAGE;
}

/**
 * Get language from country code
 *
 * This uses Cloudflare's cf.country header
 */
export function getLanguageFromCountry(
  countryCode: string | null,
): SupportedLanguage {
  if (!countryCode) return DEFAULT_LANGUAGE;

  const country = countryCode.toUpperCase();

  // English-speaking countries
  const englishCountries = [
    "US",
    "GB",
    "CA",
    "AU",
    "NZ",
    "IE",
    "SG",
    "IN",
    "PH",
    "MY",
    "ZA",
  ];

  if (englishCountries.includes(country)) {
    return "en";
  }

  // Korea
  if (country === "KR") {
    return "ko";
  }

  // Japan
  if (country === "JP") {
    return "ja";
  }

  // Default to Japanese for other countries
  return DEFAULT_LANGUAGE;
}

/**
 * Validate language code
 */
export function isValidLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

/**
 * Get next language in cycle (for toggle button)
 */
export function getNextLanguage(current: SupportedLanguage): SupportedLanguage {
  const currentIndex = SUPPORTED_LANGUAGES.indexOf(current);
  const nextIndex = (currentIndex + 1) % SUPPORTED_LANGUAGES.length;
  return SUPPORTED_LANGUAGES[nextIndex];
}

// ============================================================
// UI Text Dictionary (i18n strings)
// ============================================================

/**
 * UI text dictionary: key → { ja, en, ko }
 */
export const UI_TEXTS = {
  // === Zukan page ===
  "error.title": {
    ja: "データの読み込みに失敗しました",
    en: "Failed to load data",
    ko: "데이터 로딩에 실패했습니다",
  },
  "error.languageUnavailable": {
    ja: "言語データが利用できないため、現在の表示を維持しています。",
    en: "Language data is currently unavailable. Keeping the current view.",
    ko: "언어 데이터를 사용할 수 없어 현재 화면을 유지합니다.",
  },
  "loading.text": {
    ja: "データを読み込んでいます...",
    en: "Loading data...",
    ko: "데이터를 불러오는 중...",
  },
  "loading.subtext": {
    ja: "言語データを切り替え中...",
    en: "Switching language data...",
    ko: "언어 데이터를 전환 중...",
  },
  "logo.alt": {
    ja: "Akyoずかんロゴ",
    en: "Akyodex Logo",
    ko: "Akyo도감 로고",
  },
  "page.title": {
    ja: "Akyoずかん",
    en: "Akyodex",
    ko: "아쿄 도감",
  },
  "nav.primary": {
    ja: "主要ナビゲーション",
    en: "Primary navigation",
    ko: "주요 내비게이션",
  },
  "language.switchTo": {
    ja: "{lang}表示に切り替える",
    en: "Switch to {lang}",
    ko: "{lang} 표시로 전환",
  },
  "languageNames.ja": {
    ja: "日本語",
    en: "Japanese",
    ko: "일본어",
  },
  "languageNames.en": {
    ja: "英語 (English)",
    en: "English",
    ko: "영어 (English)",
  },
  "languageNames.ko": {
    ja: "韓国語 (Korean)",
    en: "Korean",
    ko: "한국어",
  },
  "list.tableCaption": {
    ja: "Akyo リスト",
    en: "Akyo List",
    ko: "Akyo 리스트",
  },
  "skip.mainContent": {
    ja: "メインコンテンツへスキップ",
    en: "Skip to main content",
    ko: "주요 콘텐츠로 건너뛰기",
  },
  "stats.total": {
    ja: "全{count}体",
    en: "Total {count}",
    ko: "전체 {count}마리",
  },
  "stats.totalLabel": {
    ja: "総数",
    en: "Total entries",
    ko: "전체 항목",
  },
  "stats.displayed": {
    ja: "表示{count}体",
    en: "Showing {count}",
    ko: "{count}건 표시",
  },
  "stats.displayedLabel": {
    ja: "表示中",
    en: "Displayed entries",
    ko: "현재 표시 항목",
  },
  "stats.totalBreakdown": {
    ja: "全{avatars}アバター / {worlds}ワールド / {products}商品",
    en: "Total {avatars} avatars / {worlds} worlds / {products} products",
    ko: "전체 {avatars}개 아바타 / {worlds}개 월드 / {products}개 상품",
  },
  "stats.displayedBreakdown": {
    ja: "表示{avatars}アバター / {worlds}ワールド / {products}商品",
    en: "Showing {avatars} avatars / {worlds} worlds / {products} products",
    ko: "{avatars}개 아바타 / {worlds}개 월드 / {products}개 상품 표시",
  },
  "stats.favoritesLabel": {
    ja: "お気に入り",
    en: "Favorites",
    ko: "즐겨찾기",
  },
  "search.placeholder": {
    ja: "名前・通称・作者で検索...",
    en: "Search by name, nickname, author...",
    ko: "이름・별명・작자로 검색...",
  },
  "search.ariaLabel": {
    ja: "Akyo検索",
    en: "Search Akyo",
    ko: "Akyo 검색",
  },
  "search.clearAriaLabel": {
    ja: "検索をクリア",
    en: "Clear search",
    ko: "검색 지우기",
  },
  "chatbot.ariaLabel": {
    ja: "AIチャットアシスタント",
    en: "AI chat assistant",
    ko: "AI 채팅 도우미",
  },
  "view.card": {
    ja: "カード表示",
    en: "Card view",
    ko: "카드 보기",
  },
  "view.list": {
    ja: "リスト表示",
    en: "List view",
    ko: "리스트 보기",
  },
  "view.avatarsOnly": {
    ja: "アバターのみ表示",
    en: "Show avatars only",
    ko: "아바타만 표시",
  },
  "view.worldsOnly": {
    ja: "ワールドのみ表示",
    en: "Show worlds only",
    ko: "월드만 표시",
  },
  "view.boothOnly": {
    ja: "BOOTH商品のみ表示",
    en: "Show BOOTH products only",
    ko: "BOOTH 상품만 표시",
  },
  "notfound.title": {
    ja: "見つかりません",
    en: "No results found",
    ko: "결과를 찾을 수 없습니다",
  },
  "notfound.message": {
    ja: "検索条件を変更してみてください",
    en: "Try changing your search criteria",
    ko: "검색 조건을 변경해 보세요",
  },

  // === Filter panel ===
  "filter.category": {
    ja: "カテゴリで絞り込み",
    en: "Filter by category",
    ko: "카테고리로 필터",
  },
  "filter.allCategories": {
    ja: "すべてのカテゴリ",
    en: "All Categories",
    ko: "모든 카테고리",
  },
  "filter.categorySearch": {
    ja: "カテゴリを検索...",
    en: "Search categories...",
    ko: "카테고리 검색...",
  },
  "filter.noneSelected": {
    ja: "カテゴリ未選択（全カテゴリ対象）",
    en: "No category selected (all categories)",
    ko: "선택된 카테고리 없음 (전체)",
  },
  "filter.noCategoryMatch": {
    ja: "一致するカテゴリがありません",
    en: "No matching categories",
    ko: "일치하는 카테고리가 없습니다",
  },
  "filter.removeCategory": {
    ja: "を選択解除",
    en: "remove",
    ko: "선택 해제",
  },
  "filter.matchOr": {
    ja: "OR",
    en: "OR",
    ko: "OR",
  },
  "filter.matchAnd": {
    ja: "AND",
    en: "AND",
    ko: "AND",
  },
  "filter.clearCategories": {
    ja: "絞り込み解除",
    en: "Clear",
    ko: "필터 해제",
  },
  "filter.author": {
    ja: "作者で絞り込み",
    en: "Filter by author",
    ko: "작자로 필터",
  },
  "filter.authorSearch": {
    ja: "作者を検索...",
    en: "Search authors...",
    ko: "작자 검색...",
  },
  "filter.noneAuthorSelected": {
    ja: "作者未選択（全作者対象）",
    en: "No author selected (all authors)",
    ko: "선택된 작자 없음 (전체)",
  },
  "filter.noAuthorMatch": {
    ja: "一致する作者がありません",
    en: "No matching authors",
    ko: "일치하는 작자가 없습니다",
  },
  "filter.removeAuthor": {
    ja: "を選択解除",
    en: "remove",
    ko: "선택 해제",
  },
  "filter.clearAuthors": {
    ja: "絞り込み解除",
    en: "Clear",
    ko: "필터 해제",
  },
  "filter.allAuthors": {
    ja: "すべての作者",
    en: "All Authors",
    ko: "모든 작자",
  },
  "filter.sortToggle": {
    ja: "ソート順の切り替え",
    en: "Toggle sort order",
    ko: "정렬 순서 전환",
  },
  "filter.ascending": {
    ja: "昇順",
    en: "Ascending",
    ko: "오름차순",
  },
  "filter.descending": {
    ja: "降順",
    en: "Descending",
    ko: "내림차순",
  },
  "filter.randomToggle": {
    ja: "ランダム表示の切り替え",
    en: "Toggle random mode",
    ko: "랜덤 표시 전환",
  },
  "filter.random": {
    ja: "ランダム表示",
    en: "Random",
    ko: "랜덤 표시",
  },
  "filter.favoritesToggle": {
    ja: "お気に入りのみ表示",
    en: "Show favorites only",
    ko: "즐겨찾기만 표시",
  },
  "filter.favorites": {
    ja: "お気に入りのみ",
    en: "Favorites Only",
    ko: "즐겨찾기만",
  },
  "filter.panelShow": {
    ja: "絞り込みフィルタを開く",
    en: "Open filters",
    ko: "필터 열기",
  },
  "filter.panelHide": {
    ja: "フィルタを閉じる",
    en: "Close filters",
    ko: "필터 닫기",
  },
  "filter.panelSummary": {
    ja: "有効な絞り込み: {count}件",
    en: "Active filters: {count}",
    ko: "활성 필터: {count}개",
  },

  // === Card ===
  "card.avatarName": {
    ja: "アバター名",
    en: "Avatar",
    ko: "아바타 이름",
  },
  "card.author": {
    ja: "作者",
    en: "Author",
    ko: "작자",
  },
  "card.detail": {
    ja: "くわしく見る",
    en: "View Details",
    ko: "자세히 보기",
  },
  "card.favorite.add": {
    ja: "お気に入り登録",
    en: "Add to favorites",
    ko: "즐겨찾기 추가",
  },
  "card.favorite.remove": {
    ja: "お気に入り解除",
    en: "Remove from favorites",
    ko: "즐겨찾기 해제",
  },
  "card.download": {
    ja: "三面図をダウンロード",
    en: "Download reference sheet",
    ko: "3면도 다운로드",
  },
  "card.downloadLabel": {
    ja: "三面図DL",
    en: "Ref Sheet",
    ko: "3면도",
  },

  // === List view ===
  "list.appearance": {
    ja: "見た目",
    en: "Image",
    ko: "외관",
  },
  "list.name": {
    ja: "名前",
    en: "Name",
    ko: "이름",
  },
  "list.category": {
    ja: "カテゴリ",
    en: "Category",
    ko: "카테고리",
  },
  "list.action": {
    ja: "アクション",
    en: "Actions",
    ko: "액션",
  },
  "admin.panel": {
    ja: "管理画面",
    en: "Admin Panel",
    ko: "관리 패널",
  },

  // === Detail Modal ===
  "modal.close": {
    ja: "閉じる",
    en: "Close",
    ko: "닫기",
  },
  "modal.name": {
    ja: "なまえ",
    en: "Name",
    ko: "이름",
  },
  "modal.avatarName": {
    ja: "アバター名",
    en: "Avatar Name",
    ko: "아바타 이름",
  },
  "modal.category": {
    ja: "カテゴリ",
    en: "Category",
    ko: "카테고리",
  },
  "modal.author": {
    ja: "つくったひと",
    en: "Creator",
    ko: "만든 사람",
  },
  "modal.vrchatUrl": {
    ja: "VRChat アバターURL",
    en: "VRChat Avatar URL",
    ko: "VRChat 아바타 URL",
  },
  "modal.boothUrl": {
    ja: "BOOTH URL",
    en: "BOOTH URL",
    ko: "BOOTH URL",
  },
  "modal.bonus": {
    ja: "おまけじょうほう",
    en: "Bonus Info",
    ko: "보너스 정보",
  },
  "modal.favorite.add": {
    ja: "お気に入りに追加",
    en: "Add to Favorites",
    ko: "즐겨찾기에 추가",
  },
  "modal.favorite.remove": {
    ja: "お気に入り解除",
    en: "Remove from Favorites",
    ko: "즐겨찾기 해제",
  },
  "modal.vrchatOpen": {
    ja: "VRChatで見る",
    en: "View in VRChat",
    ko: "VRChat에서 보기",
  },
  "modal.imageZoomControl": {
    ja: "画像のズーム切り替え",
    en: "Toggle image zoom",
    ko: "이미지 확대 전환",
  },
  "modal.imageMoveZoom": {
    ja: "拡大画像を矢印キーで移動",
    en: "Move zoomed image with arrow keys",
    ko: "확대된 이미지를 방향키로 이동",
  },
  "modal.imageViewerRoleDescription": {
    ja: "インタラクティブな画像ビューワー",
    en: "Interactive image viewer",
    ko: "인터랙티브 이미지 뷰어",
  },
  "modal.zoomHint": {
    ja: "タップでズーム 🔍",
    en: "Tap to zoom 🔍",
    ko: "탭하여 확대 🔍",
  },
  "modal.dragHint": {
    ja: "ドラッグで移動 / ダブルタップで戻る",
    en: "Drag to move / Double-tap to reset",
    ko: "드래그로 이동 / 더블탭으로 원래대로",
  },
} as const satisfies Record<string, Record<SupportedLanguage, string>>;

export type UITextKey = keyof typeof UI_TEXTS;

/**
 * Translate a UI string key for the given language.
 * Falls back to Japanese if key is missing.
 */
export function t(key: UITextKey, lang: SupportedLanguage): string {
  return UI_TEXTS[key]?.[lang] ?? UI_TEXTS[key]?.ja ?? "";
}
