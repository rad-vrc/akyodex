'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  clearAriaLabel?: string;
  /** デバウンス遅延（ミリ秒）。デフォルト 200ms */
  debounceMs?: number;
  /** 外部から制御する検索クエリ値（親がリセットした場合に同期される） */
  value?: string;
}

/**
 * 検索バーコンポーネント（デバウンス付き）
 *
 * 800件以上のデータセットに対してキーストローク毎にフィルタが走るのを防ぐため、
 * デバウンスを使用して入力が落ち着いてから onSearch を発火する。
 */
export function SearchBar({
  onSearch,
  placeholder = '名前・作者・属性で検索...',
  ariaLabel = '検索',
  clearAriaLabel = '検索をクリア',
  debounceMs = 200,
  value,
}: SearchBarProps) {
  const [query, setQuery] = useState(value ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // onSearch の最新参照を保持（依存配列に含めずに済む）
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  // 現在の入力値を ref で追跡（デバウンス発火時に陳腐化チェック用）
  const queryRef = useRef(query);
  queryRef.current = query;

  const debouncedSearch = useCallback((value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // 発火時点で入力値が変わっていたら（親のリセット等）スキップ
      if (queryRef.current !== value) return;
      onSearchRef.current(value);
    }, debounceMs);
  }, [debounceMs]);

  // 親から value が変更された場合（ランダムモード切替等）に内部 state とタイマーを同期
  useEffect(() => {
    if (value !== undefined && value !== query) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setQuery(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value の変更時のみ同期
  }, [value]);

  // コンポーネントのアンマウント時にタイマーをクリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuery('');
    onSearchRef.current('');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  return (
    <div className="relative w-full">
      {/* 検索アイコン */}
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-2xl" aria-hidden="true">
        🔍
      </span>

      {/* 検索入力 */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
        className="search-input w-full rounded-[25px] border-[3px] border-[var(--primary-blue)] bg-white px-5 py-3 pl-[60px] text-[18px] focus:border-[#2b7fff] focus:ring-2 focus:ring-blue-300/50 focus:outline-none focus-visible:border-[#2b7fff] focus-visible:ring-2 focus-visible:ring-blue-300/50 focus-visible:outline-none"
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck="false"
      />

      {/* クリアボタン */}
      {query && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl hover:scale-110 transition-transform"
          aria-label={clearAriaLabel}
        >
          <span aria-hidden="true">❌</span>
        </button>
      )}
    </div>
  );
}
