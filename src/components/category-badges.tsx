'use client';

import { Fragment, useLayoutEffect, useRef } from 'react';

import {
  ensureContrastForWhiteText,
  ensureContrastOnTintedWhite,
  getCategoryColor,
  getTintedBadgeBackground,
  groupCategoriesByParent,
} from '@/lib/akyo-data-helpers';

interface CategoryBadgesProps {
  /** parseAndSortCategories 済みのカテゴリ名 */
  categories: string[];
  className?: string;
}

const STACKED = 'category-group--stacked';
const WIDE_CHILD = 'category-group--wide-child';

/**
 * 親と子が 1 行に収まらず子が 2 行目に落ちたグループに印を付ける。
 *
 * 望ましい形は「親が広ければ子は親の幅に揃う、子が広ければ親はそのまま」で、これは
 * 折り返した後に親子の幅を比べないと決まらないため CSS だけでは書けない。
 * 1 行に収まるグループには何もしない。判定は印を外した状態で行い、印を付けた後の
 * レイアウト（縦積み）で再判定しないようにまとめて読んでからまとめて書く。
 */
function markStackedGroups(root: HTMLElement) {
  const groups = Array.from(root.querySelectorAll<HTMLElement>('.category-group'));
  for (const group of groups) group.classList.remove(STACKED, WIDE_CHILD);
  const marks = groups.map((group) => {
    const parent = group.querySelector<HTMLElement>('.category-group__parent');
    const child = group.querySelector<HTMLElement>('.category-group__children');
    if (!parent || !child) return null;
    const stacked = child.offsetTop > parent.offsetTop;
    return { group, stacked, wideChild: stacked && child.offsetWidth > parent.offsetWidth };
  });
  for (const mark of marks) {
    if (!mark?.stacked) continue;
    mark.group.classList.add(STACKED);
    if (mark.wideChild) mark.group.classList.add(WIDE_CHILD);
  }
}

/**
 * 一覧カード・リスト表示のカテゴリ表示（押せない表示専用）。
 *
 * 最上位カテゴリごとに 1 つのグループにまとめ、親は濃色ベタ＋白文字、子は薄底＋濃色文字で
 * 「動物 | うま, 両生類」と並べる（詳細モーダルの白文字ピルと同じ塗りの文法）。
 * 旧表示は「動物」「動物/うま」「動物/両生類」を別チップで並べ、親名の繰り返しで幅を
 * 使っていた。16 件のカードで 781px → 579px（幅 227px 実測）。
 * 子の区切りはデータと同じ「,」。「・」はカテゴリ名そのものに含まれるため使わない。
 * 押せないので WCAG 2.5.8（24px ターゲット）は対象外。文字色は白文字 4.5:1 と
 * 薄底上 4.5:1 をそれぞれ既存の補正関数で確保する。
 *
 * 親と子の境目は見た目では色で分かるが、テキストとしては何も無いので読み上げ・検索・
 * コピーで「動物うま, 両生類」と連結してしまう（WCAG 1.3.1）。画面には出ない sr-only の
 * 「/」を親子の間に置き、グループ同士の間にも空白を置いて「動物/うま, 両生類 次元」と
 * データの正規トークン（動物/うま）が文字列として残るようにする。flex コンテナ内の
 * 空白テキストはレイアウトに影響しない。
 */
export function CategoryBadges({ categories, className }: CategoryBadgesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const groups = groupCategoriesByParent(categories);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    markStackedGroups(root);
    if (typeof ResizeObserver === 'undefined') return;
    // 幅が変わる（ウィンドウのリサイズ、列数の変化）と折り返しも変わるので再判定する。
    // 印の付け外しで root の高さが変わると再度呼ばれるが、結果が同じなら DOM は変わらず止まる
    const observer = new ResizeObserver(() => markStackedGroups(root));
    observer.observe(root);
    return () => observer.disconnect();
  }, [categories]);

  if (groups.length === 0) return null;
  return (
    <div ref={rootRef} className={`flex flex-wrap gap-1${className ? ` ${className}` : ''}`}>
      {groups.map(({ parent, children }, index) => {
        const color = getCategoryColor(parent);
        return (
          <Fragment key={parent}>
            {index > 0 && ' '}
            <span className="category-group category-chip">
              <span
                className="category-group__parent"
                style={{ background: ensureContrastForWhiteText(color) }}
              >
                {parent}
              </span>
              {children.length > 0 && (
                <>
                  <span className="sr-only">/</span>
                  <span
                    className="category-group__children"
                    style={{
                      background: getTintedBadgeBackground(color),
                      color: ensureContrastOnTintedWhite(color),
                    }}
                  >
                    {children.join(', ')}
                  </span>
                </>
              )}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
