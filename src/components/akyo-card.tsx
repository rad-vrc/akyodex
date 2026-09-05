"use client";

import { IconDownload, IconHeart, IconHeartOutline, IconVRChat } from "@/components/icons";
import {
  ensureContrastOnTintedWhite,
  getTintedBadgeBackground,
  getCategoryColor,
  parseAndSortCategories,
} from "@/lib/akyo-data-helpers";
import {
  formatDisplayId,
  getAkyoSourceUrl,
  getDisplaySerial,
  resolveEntryType,
} from "@/lib/akyo-entry";
import { generateBlurDataURL } from "@/lib/blur-data-url";
import { t, type SupportedLanguage } from "@/lib/i18n";
import { buildAvatarImageUrl, safeOpenVRChatLink } from "@/lib/vrchat-utils";
import type { AkyoData } from "@/types/akyo";
import Image from "next/image";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useRef,
  useState,
} from "react";

/**
 * Props for the AkyoCard component
 */
interface AkyoCardProps {
  /** The Akyo data object to display */
  akyo: AkyoData;
  /** Currently selected language for translations (default: 'ja') */
  lang?: SupportedLanguage;
  /** Optional callback when the favorite button is clicked */
  onToggleFavorite?: (id: string) => void;
  /** Optional callback when the card is clicked to show details */
  onShowDetail?: (akyo: AkyoData, triggerElement?: HTMLElement | null) => void;
  /** Prioritize image loading for above-the-fold cards */
  priority?: boolean;
}

export function shouldBypassImageOptimization(
  src: string,
  r2BaseUrl = "https://images.akyodex.com",
): boolean {
  const normalizedR2BaseUrl = r2BaseUrl.replace(/\/$/, "");
  return (
    src.startsWith("/api/") ||
    src.startsWith("/images/") ||
    src.startsWith(`${normalizedR2BaseUrl}/`)
  );
}

export function getCatalogCardImageRequestWidth(entryType: string): number {
  return entryType === "world" ? 512 : 768;
}

export function shouldPrioritizeCatalogCardImage(index: number): boolean {
  return index === 0;
}

export function getCatalogCardPrimaryImageSrc(
  akyo: Pick<AkyoData, "id">,
  cloudflareImagesEnabled: boolean,
  r2BaseUrl: string,
): string {
  return cloudflareImagesEnabled
    ? `/${akyo.id}.webp`
    : `${r2BaseUrl}/${akyo.id}.webp`;
}

export function getCatalogAvatarCardImageSrc(
  akyo: Pick<AkyoData, "id">,
): string {
  return `/api/avatar-image?id=${encodeURIComponent(akyo.id)}&w=768`;
}

/**
 * AkyoCard Component
 * Displays a single Akyo avatar as a stylized card with an image, metadata, and action buttons.
 * Supports image caching, language-aware labels, and interactive favorites.
 *
 * @param props - Component properties
 * @returns Stylized card element
 */
function AkyoCardComponent({
  akyo,
  lang = "ja",
  onToggleFavorite,
  onShowDetail,
  priority = false,
}: AkyoCardProps) {
  const cloudflareImagesEnabled =
    process.env.NEXT_PUBLIC_ENABLE_CLOUDFLARE_IMAGES === "true";
  const r2BaseUrl = (
    process.env.NEXT_PUBLIC_R2_BASE || "https://images.akyodex.com"
  ).replace(/\/$/, "");
  const sourceUrl = getAkyoSourceUrl(akyo);
  const entryType = resolveEntryType(akyo);
  const imageId = getDisplaySerial(akyo);
  const apiImageSrc = buildAvatarImageUrl(
    akyo.id,
    sourceUrl,
    getCatalogCardImageRequestWidth(entryType),
  );
  const isWorldEntry = entryType === "world";
  const directImageSrc = getCatalogCardPrimaryImageSrc(
    akyo,
    cloudflareImagesEnabled,
    r2BaseUrl,
  );
  const initialImageSrc = isWorldEntry
    ? apiImageSrc
    : getCatalogAvatarCardImageSrc(akyo);
  const placeholderImageSrc = "/images/placeholder.webp";
  // ワールドの場合はVRChat APIから最新のサムネイルを取得する（R2には古い画像が残っている可能性があるため）
  const [imageSrc, setImageSrc] = useState(initialImageSrc);
  const detailButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Handles clicks on the favorite heart icon button
   * @param e - React mouse event
   */
  const handleFavoriteClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(akyo.id);
  };

  /**
   * Handles clicks on the card body to open detail view
   */
  const handleCardClick = (triggerElement?: HTMLElement | null) => {
    onShowDetail?.(akyo, triggerElement);
  };

  /**
   * Handles clicks on the reference sheet download button.
   * Uses a server-side proxy to bypass CORS and force a download.
   * @param e - React mouse event
   */
  const handleDownloadClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // APIエンドポイント経由でダウンロード（Content-Disposition: attachment が設定される）
    const downloadUrl = `/api/download-reference?id=${imageId}`;

    // 新しいウィンドウ/タブで開くとダウンロードがトリガーされる
    window.location.href = downloadUrl;
  };

  /**
   * Handles clicks on the VRChat logo button to open the external detail page safely.
   * @param e - React mouse event
   */
  const handleVRChatClick = (e: ReactMouseEvent) => {
    safeOpenVRChatLink(e, sourceUrl);
  };

  // 互換性のため新旧フィールドをチェック
  const category = akyo.category || akyo.attribute;
  const author = akyo.author || akyo.creator;
  const sortedCategories = category ? parseAndSortCategories(category) : [];
  const displayName = akyo.nickname || akyo.avatarName;
  const cardLabel = `${formatDisplayId(akyo)} ${displayName} ${t("card.detail", lang)}`;

  return (
    <article
      className="akyo-card relative flex h-full flex-col"
      aria-labelledby={`card-title-${akyo.id}`}
    >
      <button
        type="button"
        data-card-trigger="true"
        className="absolute inset-0 z-10 rounded-[20px] bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300 focus-visible:ring-offset-2"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => handleCardClick(detailButtonRef.current)}
      />
      {/* 画像 */}
      <div className="relative w-full aspect-[3/2] bg-gray-100">
        <Image
          src={imageSrc}
          alt={imageSrc === placeholderImageSrc ? "" : displayName}
          role={imageSrc === placeholderImageSrc ? "presentation" : undefined}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
          className="object-cover"
          unoptimized={shouldBypassImageOptimization(imageSrc, r2BaseUrl)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          placeholder="blur"
          blurDataURL={generateBlurDataURL(imageId)}
          onError={() => {
            if (isWorldEntry) {
              // ワールド: VRChat API → R2画像 → placeholder
              // bypassCloudflare パラメータは vrc-world-image では無視されるため、
              // 冗長な再試行を避けてR2画像にフォールバックする
              if (imageSrc === apiImageSrc) {
                setImageSrc(directImageSrc);
                return;
              }
              if (imageSrc !== placeholderImageSrc) {
                setImageSrc(placeholderImageSrc);
              }
            } else {
              // アバター: 768px変換API → R2原画像 → placeholder
              if (imageSrc === initialImageSrc) {
                setImageSrc(directImageSrc);
                return;
              }
              if (imageSrc !== placeholderImageSrc) {
                setImageSrc(placeholderImageSrc);
              }
            }
          }}
        />

        {/* お気に入りボタン */}
        <button
          type="button"
          onClick={handleFavoriteClick}
          className={`favorite-btn absolute top-2 right-2 z-20${akyo.isFavorite ? " is-active" : ""}`}
          aria-label={
            akyo.isFavorite
              ? t("card.favorite.remove", lang)
              : t("card.favorite.add", lang)
          }
        >
          {akyo.isFavorite ? (
            <IconHeart size="w-5 h-5" className="text-pink-400" />
          ) : (
            <IconHeartOutline size="w-5 h-5" className="text-pink-300" />
          )}
        </button>
      </div>

      {/* カード情報 */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* VRChatリンク と 三面図DLボタン */}
        <div className="relative z-20 flex items-center mb-1">
          {sourceUrl && (
            <button
              type="button"
              onClick={handleVRChatClick}
              className="vrchat-link-button -ml-0.5 flex-shrink-0 p-0 transition-transform origin-left translate-y-[2px] scale-[1.1] hover:scale-[1.15] active:scale-[1.05] flex items-center justify-start min-h-[44px] min-w-[44px]"
              title={t("modal.vrchatOpen", lang)}
              aria-label={t("modal.vrchatOpen", lang)}
            >
              <IconVRChat
                size="w-12 h-12 max-sm:w-[75px] max-sm:h-[75px]"
                className="text-black flex-shrink-0"
                overflow="visible"
              />
            </button>
          )}
          {entryType === "avatar" && (
            <button
              type="button"
              onClick={handleDownloadClick}
              className="reference-sheet-button ml-auto flex-shrink-0 origin-right scale-90 max-sm:scale-100"
              title={t("card.download", lang)}
              aria-label={t("card.download", lang)}
            >
              <IconDownload size="w-4 h-4" />
              <span className="text-xs max-sm:text-sm">{t("card.downloadLabel", lang)}</span>
            </button>
          )}
        </div>

        {/* ID（通称の直上） */}
        <div className="mb-1 w-full flex items-center gap-1.5">
          <span className="text-sm font-bold text-gray-500">
            {formatDisplayId(akyo)}
          </span>
          {/* BOOTHリンクは min-h-[44px]+負マージンで、バナーの見た目(18px)は変えず
              タップ領域だけApple HIGの44ptへ拡大。-my-[13px]=(44-18)/2 で行高を相殺 */}
          {akyo.boothUrl && (
            <a
              href={akyo.boothUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-20 ml-auto flex-shrink-0 flex items-center min-h-[44px] -my-[13px] px-1.5 -mx-1.5 transition-transform hover:scale-105 active:scale-95 -translate-y-px"
              onClick={(e) => e.stopPropagation()}
              aria-label="BOOTH"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/booth-banner.png"
                alt="BOOTH"
                width={51}
                height={18}
                className="h-[18px] w-auto"
                loading="lazy"
              />
            </a>
          )}
        </div>

        {/* タイトル - 元の実装と同じフォント */}
        <h3 id={`card-title-${akyo.id}`} className="font-bold text-lg mb-1 text-gray-800 line-clamp-2">
          {displayName}
        </h3>

        {/* 作者情報 - 元の実装と同じ形式 (改行あり、:付き) */}
        <p className="text-xs text-gray-600 mb-2 whitespace-pre-line">
          {!isWorldEntry &&
            akyo.nickname &&
            akyo.avatarName &&
            akyo.nickname !== akyo.avatarName && (
              <>
                {t("card.avatarName", lang)}: {akyo.avatarName}
                {"\n"}
              </>
            )}
          {t("card.author", lang)}: {author}
        </p>

        {/* 属性バッジ */}
        {category && (
          <div className="flex flex-wrap gap-1 mb-2">
            {sortedCategories.map((trimmedCat, index) => {
              const color = getCategoryColor(trimmedCat);
              return (
                <span
                  key={index}
                  className="category-badge"
                  style={{
                    background: getTintedBadgeBackground(color),
                    color: ensureContrastOnTintedWhite(color),
                  }}
                >
                  {trimmedCat}
                </span>
              );
            })}
          </div>
        )}

        {/* くわしく見るボタン */}
        <button
          ref={detailButtonRef}
          type="button"
          onClick={(e) => handleCardClick(e.currentTarget)}
          className="detail-button relative z-20 mt-auto w-full flex items-center justify-center gap-2"
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">🌟</span>
          <span>{t("card.detail", lang)}</span>
          <span aria-hidden="true">🌟</span>
        </button>
      </div>
    </article>
  );
}

export const AkyoCard = memo(AkyoCardComponent);
