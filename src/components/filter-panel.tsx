'use client';

import {
  IconDice,
  IconHeart,
  IconSortAsc,
  IconSortDesc,
  IconSparkles,
  IconTag,
  IconUser,
} from '@/components/icons';
import { t, type SupportedLanguage } from '@/lib/i18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface FilterPanelProps {
  // 新フィールド（オプショナル）
  categories?: string[];
  authors?: string[];

  // 旧フィールド（互換性維持、必須のまま）
  attributes: string[];
  creators: string[];

  // 新しいカテゴリ選択
  selectedAttributes?: string[];
  categoryMatchMode?: 'or' | 'and';
  onAttributesChange?: (attributes: string[]) => void;
  onCategoryMatchModeChange?: (mode: 'or' | 'and') => void;

  // 旧フィールド（互換）
  selectedAttribute?: string;
  selectedCreators?: string[];
  selectedCreator?: string;
  onAttributeChange?: (attribute: string) => void;
  onCreatorsChange?: (creators: string[]) => void;
  onCreatorChange?: (creator: string) => void;

  onSortToggle: () => void;
  onRandomClick: () => void;
  onFavoritesClick: () => void;
  favoritesOnly: boolean;
  sortAscending: boolean;
  randomMode: boolean;
  lang?: SupportedLanguage;
  disabled?: boolean;
}

export function FilterPanel({
  categories,
  authors,
  attributes,
  creators,
  selectedAttributes,
  categoryMatchMode = 'or',
  onAttributesChange,
  onCategoryMatchModeChange,
  selectedCreators,
  selectedAttribute,
  selectedCreator,
  onAttributeChange,
  onCreatorsChange,
  onCreatorChange,
  onSortToggle,
  onRandomClick,
  onFavoritesClick,
  favoritesOnly,
  sortAscending,
  randomMode,
  lang = 'ja',
  disabled = false,
}: FilterPanelProps) {
  const [categoryQuery, setCategoryQuery] = useState('');
  const [authorQuery, setAuthorQuery] = useState('');
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
  const [focusedAuthorIndex, setFocusedAuthorIndex] = useState(0);
  const categoryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const authorButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const matchModeIdPrefix = useId();
  const matchOrId = `${matchModeIdPrefix}-match-or`;
  const matchAndId = `${matchModeIdPrefix}-match-and`;

  const displayCategories = categories || attributes;
  const displayAuthors = authors || creators;
  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const normalizedAuthorQuery = authorQuery.trim().toLowerCase();
  const activeCategories = useMemo(
    () =>
      selectedAttributes?.length
        ? selectedAttributes
        : selectedAttribute
          ? [selectedAttribute]
          : [],
    [selectedAttributes, selectedAttribute]
  );
  const activeAuthors = useMemo(
    () =>
      selectedCreators?.length
        ? selectedCreators
        : selectedCreator
          ? [selectedCreator]
          : [],
    [selectedCreators, selectedCreator]
  );

  const filteredCategories = useMemo(() => {
    if (!normalizedCategoryQuery) return displayCategories;
    return displayCategories.filter((category) =>
      category.toLowerCase().includes(normalizedCategoryQuery)
    );
  }, [displayCategories, normalizedCategoryQuery]);
  const filteredAuthors = useMemo(() => {
    if (!normalizedAuthorQuery) return displayAuthors;
    return displayAuthors.filter((author) => author.toLowerCase().includes(normalizedAuthorQuery));
  }, [displayAuthors, normalizedAuthorQuery]);

  useEffect(() => {
    categoryButtonRefs.current = categoryButtonRefs.current.slice(0, filteredCategories.length);
    if (filteredCategories.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedCategoryIndex(-1);
      return;
    }
    setFocusedCategoryIndex((current) => {
      if (current < 0) return 0;
      if (current >= filteredCategories.length) return filteredCategories.length - 1;
      return current;
    });
  }, [filteredCategories]);
  useEffect(() => {
    authorButtonRefs.current = authorButtonRefs.current.slice(0, filteredAuthors.length);
    if (filteredAuthors.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedAuthorIndex(-1);
      return;
    }
    setFocusedAuthorIndex((current) => {
      if (current < 0) return 0;
      if (current >= filteredAuthors.length) return filteredAuthors.length - 1;
      return current;
    });
  }, [filteredAuthors]);

  const setCategories = (nextCategories: string[]) => {
    if (onAttributesChange) {
      onAttributesChange(nextCategories);
      return;
    }
    onAttributeChange?.(nextCategories[0] || '');
  };

  const toggleCategory = (category: string) => {
    if (activeCategories.includes(category)) {
      setCategories(activeCategories.filter((value) => value !== category));
      return;
    }
    if (!onAttributesChange) {
      setCategories([category]);
      return;
    }
    setCategories([...activeCategories, category]);
  };
  const addCategory = (category: string) => {
    if (activeCategories.includes(category)) return;
    if (!onAttributesChange) {
      setCategories([category]);
      return;
    }
    setCategories([...activeCategories, category]);
  };
  const setAuthors = (nextAuthors: string[]) => {
    if (onCreatorsChange) {
      onCreatorsChange(nextAuthors);
      return;
    }
    onCreatorChange?.(nextAuthors[0] || '');
  };

  const toggleAuthor = (author: string) => {
    if (activeAuthors.includes(author)) {
      setAuthors(activeAuthors.filter((value) => value !== author));
      return;
    }
    if (!onCreatorsChange) {
      setAuthors([author]);
      return;
    }
    setAuthors([...activeAuthors, author]);
  };
  const addAuthor = (author: string) => {
    if (activeAuthors.includes(author)) return;
    if (!onCreatorsChange) {
      setAuthors([author]);
      return;
    }
    setAuthors([...activeAuthors, author]);
  };

  const moveCategoryFocus = (nextIndex: number) => {
    setFocusedCategoryIndex(nextIndex);
    const target = categoryButtonRefs.current[nextIndex];
    target?.focus();
    target?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  };
  const moveAuthorFocus = (nextIndex: number) => {
    setFocusedAuthorIndex(nextIndex);
    const target = authorButtonRefs.current[nextIndex];
    target?.focus();
    target?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  };

  const handleListKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
    items: string[],
    toggleFn: (item: string) => void,
    moveFocusFn: (nextIndex: number) => void
  ) => {
    const lastIndex = items.length - 1;
    if (lastIndex < 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocusFn(idx === lastIndex ? 0 : idx + 1);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocusFn(idx === 0 ? lastIndex : idx - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      moveFocusFn(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      moveFocusFn(lastIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[idx];
      if (item) toggleFn(item);
    }
  };

  const handleCategorySearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && filteredCategories.length > 0) {
      event.preventDefault();
      addCategory(filteredCategories[0]);
      setCategoryQuery('');
    }
  };
  const handleAuthorSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && filteredAuthors.length > 0) {
      event.preventDefault();
      addAuthor(filteredAuthors[0]);
      setAuthorQuery('');
    }
  };

  return (
    <fieldset
      disabled={disabled}
      aria-busy={disabled}
      className={`space-y-4 ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-orange-600 flex items-center gap-2">
              <IconSparkles size="w-4 h-4" />
              {t('filter.category', lang)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeCategories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCategories([])}
                  className="px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 hover:bg-red-200 transition-colors"
                  aria-label={t('filter.clearCategories', lang)}
                >
                  {t('filter.clearCategories', lang)}
                </button>
              )}
              {onCategoryMatchModeChange && (
                <fieldset className="inline-flex rounded-full bg-gray-100 p-1 border border-gray-200">
                  <legend className="sr-only">
                    {`${t('filter.matchOr', lang)} / ${t('filter.matchAnd', lang)}`}
                  </legend>
                  <input
                    id={matchOrId}
                    type="radio"
                    name={`${matchModeIdPrefix}-category-match-mode`}
                    className="sr-only"
                    checked={categoryMatchMode === 'or'}
                    onChange={() => onCategoryMatchModeChange('or')}
                    aria-label={t('filter.matchOr', lang)}
                  />
                  <label
                    htmlFor={matchOrId}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors cursor-pointer ${
                      categoryMatchMode === 'or'
                        ? 'bg-blue-200 text-blue-900'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t('filter.matchOr', lang)}
                  </label>
                  <input
                    id={matchAndId}
                    type="radio"
                    name={`${matchModeIdPrefix}-category-match-mode`}
                    className="sr-only"
                    checked={categoryMatchMode === 'and'}
                    onChange={() => onCategoryMatchModeChange('and')}
                    aria-label={t('filter.matchAnd', lang)}
                  />
                  <label
                    htmlFor={matchAndId}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors cursor-pointer ${
                      categoryMatchMode === 'and'
                        ? 'bg-green-200 text-green-900'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t('filter.matchAnd', lang)}
                  </label>
                </fieldset>
              )}
            </div>
          </div>

          <input
            type="text"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            onKeyDown={handleCategorySearchKeyDown}
            className="w-full rounded-xl border-2 border-orange-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:outline-none focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-300/50"
            placeholder={t('filter.categorySearch', lang)}
            aria-label={t('filter.categorySearch', lang)}
          />

          <div className="flex flex-wrap gap-2 min-h-8">
            {activeCategories.length === 0 ? (
              <span className="text-xs text-gray-700">
                {t('filter.noneSelected', lang)}
              </span>
            ) : (
              activeCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="attribute-badge bg-orange-100 text-orange-900 hover:bg-orange-200 border border-orange-300"
                  aria-label={`${category} ${t('filter.removeCategory', lang)}`}
                >
                  <IconTag size="w-3 h-3" /> {category} ×
                </button>
              ))
            )}
          </div>

          <div
            className={`max-h-52 rounded-xl border border-gray-200 bg-white p-2 ${disabled ? 'overflow-hidden' : 'overflow-y-auto'}`}
            aria-label={disabled ? t('filter.category', lang) : undefined}
          >
            {filteredCategories.length === 0 ? (
              <div className="px-2 py-3 text-xs text-[var(--text-secondary)]">
                {t('filter.noCategoryMatch', lang)}
              </div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                role="listbox"
                aria-multiselectable="true"
                aria-label={t('filter.category', lang)}
              >
                {filteredCategories.map((category, idx) => {
                  const selected = activeCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      role="option"
                      ref={(el) => {
                        categoryButtonRefs.current[idx] = el;
                      }}
                      onClick={() => toggleCategory(category)}
                      onFocus={() => setFocusedCategoryIndex(idx)}
                      onKeyDown={(event) =>
                        handleListKeyDown(
                          event,
                          idx,
                          filteredCategories,
                          toggleCategory,
                          moveCategoryFocus
                        )
                      }
                      tabIndex={focusedCategoryIndex === idx ? 0 : -1}
                      className={`text-left rounded-lg px-3 py-2 text-sm font-semibold border transition-colors focus:outline-none focus:ring-4 focus:ring-orange-300 focus:ring-offset-2 ${
                        selected
                          ? 'bg-orange-100 text-orange-900 border-orange-300'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                      aria-selected={selected}
                    >
                      {selected ? `✓ ${category}` : category}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-blue-600/80 flex items-center gap-2">
              <IconUser size="w-4 h-4" />
              {t('filter.author', lang)}
            </div>
            {activeAuthors.length > 0 && (
              <button
                type="button"
                onClick={() => setAuthors([])}
                className="px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 hover:bg-red-200 transition-colors"
                aria-label={t('filter.clearAuthors', lang)}
              >
                {t('filter.clearAuthors', lang)}
              </button>
            )}
          </div>

          <input
            type="text"
            value={authorQuery}
            onChange={(e) => setAuthorQuery(e.target.value)}
            onKeyDown={handleAuthorSearchKeyDown}
            className="w-full rounded-xl border-2 border-blue-300 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-300/50"
            placeholder={t('filter.authorSearch', lang)}
            aria-label={t('filter.authorSearch', lang)}
          />

          <div className="flex flex-wrap gap-2 min-h-8">
            {activeAuthors.length === 0 ? (
              <span className="text-xs text-gray-700">
                {t('filter.noneAuthorSelected', lang)}
              </span>
            ) : (
              activeAuthors.map((author) => (
                <button
                  key={author}
                  type="button"
                  onClick={() => toggleAuthor(author)}
                  className="attribute-badge bg-blue-100 text-blue-900 hover:bg-blue-200"
                  aria-label={`${author} ${t('filter.removeAuthor', lang)}`}
                >
                  <IconUser size="w-3 h-3" /> {author} ×
                </button>
              ))
            )}
          </div>

          <div
            className={`max-h-52 rounded-xl border border-gray-200 bg-white p-2 ${disabled ? 'overflow-hidden' : 'overflow-y-auto'}`}
            aria-label={disabled ? t('filter.author', lang) : undefined}
          >
            {filteredAuthors.length === 0 ? (
              <div className="px-2 py-3 text-xs text-[var(--text-secondary)]">
                {t('filter.noAuthorMatch', lang)}
              </div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                role="listbox"
                aria-multiselectable="true"
                aria-label={t('filter.author', lang)}
              >
                {filteredAuthors.map((author, idx) => {
                  const selected = activeAuthors.includes(author);
                  return (
                    <button
                      key={author}
                      type="button"
                      role="option"
                      ref={(el) => {
                        authorButtonRefs.current[idx] = el;
                      }}
                      onClick={() => toggleAuthor(author)}
                      onFocus={() => setFocusedAuthorIndex(idx)}
                      onKeyDown={(event) =>
                        handleListKeyDown(event, idx, filteredAuthors, toggleAuthor, moveAuthorFocus)
                      }
                      tabIndex={focusedAuthorIndex === idx ? 0 : -1}
                      className={`text-left rounded-lg px-3 py-2 text-sm font-semibold border transition-colors focus:outline-none focus:ring-4 focus:ring-blue-300 focus:ring-offset-2 ${
                        selected
                          ? 'bg-blue-100 text-blue-900 border-blue-300'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                      aria-selected={selected}
                    >
                      {selected ? `✓ ${author}` : author}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
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
        </button>

        <button
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
        </button>
      </div>
    </fieldset>
  );
}
