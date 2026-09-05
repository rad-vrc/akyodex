'use client';

import { IconDice, IconHeart, IconHistory, IconSortAsc, IconSortDesc } from '@/components/icons';
import { t, type SupportedLanguage } from '@/lib/i18n';
import type { ReactNode } from 'react';

interface SortControlsProps {
  onSortToggle: () => void;
  onLatestClick: () => void;
  onRandomClick?: () => void;
  onFavoritesClick?: () => void;
  favoritesOnly?: boolean;
  sortAscending: boolean;
  latestMode: boolean;
  randomMode?: boolean;
  lang?: SupportedLanguage;
  disabled?: boolean;
  children?: ReactNode;
}

/**
 * 昇順/降順・最新100件・ランダム表示・お気に入りのみ の並び替えコントロール。
 * 元は FilterPanel の末尾にあったが、モバイルでは絞り込みフィルタが初期状態で
 * 閉じておりソートへ即アクセスできなかったため、折りたたみ領域の外へ独立させた。
 */
export function SortControls({
  onSortToggle,
  onLatestClick,
  onRandomClick,
  onFavoritesClick,
  favoritesOnly,
  sortAscending,
  latestMode,
  randomMode,
  lang = 'ja',
  disabled = false,
  children,
}: SortControlsProps) {
  return (
    <fieldset
      disabled={disabled}
      aria-busy={disabled}
      className={`flex flex-wrap gap-2 items-center ${disabled ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={onSortToggle}
        aria-pressed={sortAscending}
        aria-label={t('filter.sortToggle', lang)}
        className={`attribute-badge quick-filter-badge transition-colors ${
          sortAscending
            ? 'bg-green-200 text-green-800 hover:bg-green-300'
            : 'bg-blue-200 text-blue-800 hover:bg-blue-300'
        }`}
      >
        {sortAscending ? <IconSortAsc size="w-4 h-4" /> : <IconSortDesc size="w-4 h-4" />}{' '}
        {sortAscending ? t('filter.ascending', lang) : t('filter.descending', lang)}
      </button>

      <button
        type="button"
        onClick={onLatestClick}
        aria-pressed={latestMode}
        aria-label={t('filter.latestToggle', lang)}
        className={`attribute-badge quick-filter-badge transition-colors ${
          latestMode
            ? 'bg-orange-200 text-orange-800 hover:bg-orange-300'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        <IconHistory size="w-4 h-4" /> {t('filter.latest', lang)}
      </button>

      {children}

      {onRandomClick && <button
        type="button"
        onClick={onRandomClick}
        aria-pressed={randomMode}
        aria-label={t('filter.randomToggle', lang)}
        className={`attribute-badge quick-filter-badge transition-colors ${
          randomMode
            ? 'bg-yellow-200 text-yellow-800 hover:bg-yellow-300'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        <IconDice size="w-4 h-4" /> {t('filter.random', lang)}
      </button>}

      {onFavoritesClick && <button
        type="button"
        onClick={onFavoritesClick}
        aria-pressed={favoritesOnly}
        aria-label={t('filter.favoritesToggle', lang)}
        className={`attribute-badge quick-filter-badge transition-colors ${
          favoritesOnly
            ? 'bg-pink-200 text-pink-800 hover:bg-pink-300'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
        }`}
      >
        <IconHeart size="w-4 h-4" /> {t('filter.favorites', lang)}
      </button>}
    </fieldset>
  );
}
