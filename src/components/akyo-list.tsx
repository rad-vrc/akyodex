'use client';

import { IconHeart, IconHeartOutline, IconInfoCircle, IconVRChat } from '@/components/icons';
import { ensureContrastOnWhite, getCategoryColor, parseAndSortCategories } from '@/lib/akyo-data-helpers';
import { formatDisplayId, getAkyoSourceUrl, resolveEntryType } from '@/lib/akyo-entry';
import { generateBlurDataURL } from '@/lib/blur-data-url';
import { t, type SupportedLanguage } from '@/lib/i18n';
import { buildAvatarImageUrl, safeOpenVRChatLink } from '@/lib/vrchat-utils';
import type { AkyoData } from '@/types/akyo';
import Image from 'next/image';
import {
  type MouseEvent as ReactMouseEvent,
  useRef,
} from 'react';

/**
 * Props for the AkyoList component
 */
interface AkyoListProps {
  /** Array of Akyo data objects to display in the list */
  data: AkyoData[];
  /** Currently selected language for translations (default: 'ja') */
  lang?: SupportedLanguage;
  /** Optional callback when the favorite button is clicked */
  onToggleFavorite?: (id: string) => void;
  /** Optional callback when a row is clicked to show details */
  onShowDetail?: (akyo: AkyoData, triggerElement?: HTMLElement | null) => void;
}

/**
 * AkyoList Component
 * Displays a list (table) of Akyo avatars with basic information and action buttons.
 * Optimized for desktop viewing and provides quick access to details and external links.
 *
 * @param props - Component properties
 * @returns Table-based list element
 */
export function AkyoList({ data, lang = 'ja', onToggleFavorite, onShowDetail }: AkyoListProps) {
  const rowDetailTriggerRefs = useRef(new Map<string, HTMLButtonElement | null>());

  /**
   * Handles click on the favorite icon button
   * @param e - Event object
   * @param id - Akyo ID
   */
  const handleFavoriteClick = (e: ReactMouseEvent, id: string) => {
    e.stopPropagation();
    onToggleFavorite?.(id);
  };

  /**
   * Handles click on the info/detail icon button
   * @param e - Event object
   * @param akyo - Akyo data object
   */
  const handleDetailClick = (e: ReactMouseEvent<HTMLButtonElement>, akyo: AkyoData) => {
    e.stopPropagation();
    onShowDetail?.(akyo, e.currentTarget);
  };

  /**
   * Handles click on the VRChat logo button to open the external detail page safely.
   * @param e - React mouse event
   * @param url - The target VRChat URL
   */
  const handleVRChatClick = (e: ReactMouseEvent, url: string | undefined) => {
    safeOpenVRChatLink(e, url);
  };

  const handleRowDetailClick = (
    e: ReactMouseEvent<HTMLButtonElement>,
    akyo: AkyoData,
    triggerElement: HTMLElement | null
  ) => {
    e.stopPropagation();
    onShowDetail?.(akyo, triggerElement);
  };

  const setRowDetailTriggerRef =
    (id: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        rowDetailTriggerRefs.current.set(id, element);
        return;
      }

      rowDetailTriggerRefs.current.delete(id);
    };

  const renderRowDetailTrigger = (
    akyo: AkyoData,
    label: string,
    options?: { hiddenFromAssistiveTech?: boolean }
  ) => (
    <button
      ref={options?.hiddenFromAssistiveTech ? undefined : setRowDetailTriggerRef(akyo.id)}
      type="button"
      className="absolute inset-0 z-0 h-full w-full cursor-pointer bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-inset"
      aria-label={options?.hiddenFromAssistiveTech ? undefined : label}
      aria-hidden={options?.hiddenFromAssistiveTech || undefined}
      tabIndex={options?.hiddenFromAssistiveTech ? -1 : 0}
      onClick={(e) =>
        handleRowDetailClick(
          e,
          akyo,
          options?.hiddenFromAssistiveTech
            ? rowDetailTriggerRefs.current.get(akyo.id) ?? null
            : e.currentTarget
        )
      }
    />
  );

  return (
    <div className="list-view-container">
      <div className="list-scroll-wrapper">
        <table className="list-view-table">
          <caption className="sr-only">{t('list.tableCaption', lang)}</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">{t('list.appearance', lang)}</th>
              <th scope="col">{t('list.name', lang)}</th>
              <th scope="col">{t('list.category', lang)}</th>
              <th scope="col">{t('card.author', lang)}</th>
              <th scope="col">{t('list.action', lang)}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((akyo) => {
              const category = akyo.category || akyo.attribute || '';
              const author = akyo.author || akyo.creator || '';
              const sortedCategories = parseAndSortCategories(category);
              const isWorldEntry = resolveEntryType(akyo) === 'world';
              const sourceUrl = getAkyoSourceUrl(akyo);
              const rowDetailLabel = `${formatDisplayId(akyo)} ${akyo.nickname || akyo.avatarName} ${t('card.detail', lang)}`;

              return (
                <tr
                  key={akyo.id}
                  className="group relative hover:bg-orange-50/50 transition-colors"
                >
                  {/* No. */}
                  <td className="font-mono text-sm relative">
                    {renderRowDetailTrigger(akyo, rowDetailLabel, { hiddenFromAssistiveTech: true })}
                    <span className="relative z-10 pointer-events-none">{formatDisplayId(akyo)}</span>
                  </td>

                  {/* 見た目 */}
                  <td className="relative">
                    {renderRowDetailTrigger(akyo, rowDetailLabel, { hiddenFromAssistiveTech: true })}
                    <div className="list-image-wrapper relative z-10 pointer-events-none">
                      <Image
                        src={buildAvatarImageUrl(akyo.id, sourceUrl, 96)}
                        alt={akyo.avatarName || akyo.nickname}
                        width={48}
                        height={48}
                        className="object-cover"
                        loading="lazy"
                        unoptimized
                        placeholder="blur"
                        blurDataURL={generateBlurDataURL(akyo.id)}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = '/images/placeholder.webp';
                        }}
                      />
                    </div>
                  </td>

                  {/* 名前 */}
                  <td className="relative">
                    {renderRowDetailTrigger(akyo, rowDetailLabel)}
                    <div className="relative z-10 pointer-events-none font-medium text-[var(--text-primary)]">
                      {akyo.nickname || akyo.avatarName}
                    </div>
                    {!isWorldEntry && akyo.nickname && akyo.avatarName && (
                      <div className="relative z-10 pointer-events-none text-xs text-[var(--text-secondary)]">
                        {akyo.nickname === akyo.avatarName
                          ? `${t('card.avatarName', lang)}: ${akyo.avatarName}`
                          : akyo.avatarName}
                      </div>
                    )}
                  </td>

                  {/* カテゴリ */}
                  <td className="relative">
                    {renderRowDetailTrigger(akyo, rowDetailLabel, { hiddenFromAssistiveTech: true })}
                    <div className="relative z-10 pointer-events-none flex flex-wrap gap-1">
                      {sortedCategories.map((trimmedCat, index) => {
                        const color = getCategoryColor(trimmedCat);
                        return (
                          <span
                            key={index}
                            className="attribute-badge"
                            style={{
                              background: `${color}20`,
                              color: ensureContrastOnWhite(color),
                              boxShadow: `0 6px 12px ${color}20`,
                            }}
                          >
                            {trimmedCat}
                          </span>
                        );
                      })}
                    </div>
                  </td>

                  {/* 作者 */}
                  <td className="relative text-sm text-[var(--text-secondary)]">
                    {renderRowDetailTrigger(akyo, rowDetailLabel, { hiddenFromAssistiveTech: true })}
                    <span className="relative z-10 pointer-events-none">{author}</span>
                  </td>

                  {/* アクション */}
                  <td className="text-center relative z-10">
                    <div className="flex items-center justify-center gap-1">
                      {/* VRChatリンク */}
                      {sourceUrl && (
                        <button
                          type="button"
                          onClick={(e) => handleVRChatClick(e, sourceUrl)}
                          className="vrchat-link-button flex-shrink-0 p-1 transition-all hover:scale-110 active:scale-95"
                          title={t('modal.vrchatOpen', lang)}
                          aria-label={t('modal.vrchatOpen', lang)}
                        >
                          <IconVRChat size="w-10 h-10" className="text-black" overflow="visible" />
                        </button>
                      )}

                      {/* お気に入りボタン */}
                      <button
                        type="button"
                        onClick={(e) => handleFavoriteClick(e, akyo.id)}
                        className="list-action-btn"
                        aria-label={
                          akyo.isFavorite
                            ? t('card.favorite.remove', lang)
                            : t('card.favorite.add', lang)
                        }
                      >
                        {akyo.isFavorite ? (
                          <IconHeart size="w-5 h-5" className="list-favorite-icon text-pink-400" />
                        ) : (
                          <IconHeartOutline size="w-5 h-5" className="list-favorite-icon text-pink-300" />
                        )}
                      </button>

                      {/* 詳細ボタン */}
                      <button
                        type="button"
                        onClick={(e) => handleDetailClick(e, akyo)}
                        className="list-action-btn"
                        aria-label={t('card.detail', lang)}
                      >
                        <IconInfoCircle size="w-5 h-5" className="text-blue-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
