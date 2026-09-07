'use client';

import type { RefObject } from 'react';

import { IconClose } from '@/components/icons';

/**
 * 検索入力のクリアボタン（丸チップの ×）
 *
 * 絵文字ではなく SVG を使う。絵文字は OS のカラーフォントで描かれ CSS の
 * color が効かないため、コントラストを設計できない（実測 2.84:1）。
 *
 * 位置と寸法は CSS 変数から導出する。入力欄側の右パディングも同じ変数を
 * 使うので、片方だけ変えて入力テキストがボタンの下に潜ることがない。
 */

type Size = 'md' | 'sm';
type Tone = 'blue' | 'orange';

/** md: 高さ 57px の検索バー用 / sm: 高さ 40px の絞り込み用 */
const SIZES: Record<Size, { hit: string; chip: string; icon: string }> = {
  md: {
    hit: 'right-[var(--search-clear-inset)] h-[var(--search-clear-size)] w-[var(--search-clear-size)]',
    chip: 'h-7 w-7',
    icon: 'w-3.5 h-3.5',
  },
  sm: {
    hit: 'right-[var(--filter-clear-inset)] h-[var(--filter-clear-size)] w-[var(--filter-clear-size)]',
    chip: 'h-[22px] w-[22px]',
    icon: 'w-3 h-3',
  },
};

/**
 * 白い × を載せて WCAG SC 1.4.11 の 3:1 を満たす地色だけを持たせる。
 * orange-500(#f97316) は白に対して 2.80:1 で不足するため 600 を使う。
 *
 * ホバーは button 側から子の span を狙う。span の :hover に直接置くと、
 * 当たり判定のうちチップの外側はクリックできるのに色が変わらない。
 * :enabled を挟むのは、button 自身の disabled だけでなく、祖先の
 * fieldset[disabled] による無効化も拾うため。React の props では
 * 後者を知りようがない。
 */
const TONES: Record<Tone, { base: string; hover: string }> = {
  blue: {
    base: 'bg-[var(--accent-blue)]',
    hover: '[&:enabled:hover>span]:bg-[var(--accent-blue-hover)]',
  },
  orange: {
    base: 'bg-orange-600',
    hover: '[&:enabled:hover>span]:bg-orange-700',
  },
};

interface SearchClearButtonProps {
  onClick: () => void;
  /** アクセシブル名。呼び出し側で翻訳したものを渡す */
  label: string;
  /**
   * クリア後にフォーカスを戻す入力欄。押すと入力が空になり、このボタン自身が
   * アンマウントされるため、渡さないとフォーカスが body に落ちて
   * キーボード利用者は先頭から Tab し直しになる。
   */
  inputRef?: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  size?: Size;
  tone?: Tone;
}

export function SearchClearButton({
  onClick,
  label,
  inputRef,
  disabled = false,
  size = 'md',
  tone = 'blue',
}: SearchClearButtonProps) {
  const { hit, chip, icon } = SIZES[size];
  const { base, hover } = TONES[tone];

  const handleClick = () => {
    onClick();
    // アンマウントされてからでは focus() が効かないので次のフレームで戻す
    requestAnimationFrame(() => inputRef?.current?.focus());
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full ${hit} ${hover}`}
      aria-label={label}
    >
      <span
        className={`flex items-center justify-center rounded-full text-white transition-colors ${chip} ${base}`}
      >
        <IconClose size={icon} />
      </span>
    </button>
  );
}
