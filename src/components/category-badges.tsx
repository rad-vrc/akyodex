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
 */
export function CategoryBadges({ categories, className }: CategoryBadgesProps) {
  const groups = groupCategoriesByParent(categories);
  if (groups.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1${className ? ` ${className}` : ''}`}>
      {groups.map(({ parent, children }) => {
        const color = getCategoryColor(parent);
        return (
          <span key={parent} className="category-group">
            <span
              className="category-group__parent"
              style={{ background: ensureContrastForWhiteText(color) }}
            >
              {parent}
            </span>
            {children.length > 0 && (
              <span
                className="category-group__children"
                style={{
                  background: getTintedBadgeBackground(color),
                  color: ensureContrastOnTintedWhite(color),
                }}
              >
                {children.join(', ')}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
