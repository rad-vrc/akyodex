/**
 * Akyoデータの型定義
 */

export type AkyoEntryType = "avatar" | "world";

export interface AkyoData {
  id: string; // 4桁のID番号 (例: "0001")
  entryType?: AkyoEntryType; // エントリ種別（未指定時はカテゴリから補完）
  displaySerial?: string; // 表示用連番（未指定時は id を使用）
  appearance: string; // 見た目（削除予定）
  nickname: string; // 通称
  avatarName: string; // アバター名
  sourceUrl?: string; // エントリの元URL（avatar/world共通、未指定時は avatarUrl を使用）
  boothUrl?: string; // BOOTH販売ページURL（任意）

  // 新スキーマ
  category: string; // 属性（旧 attribute）
  comment: string; // 備考（旧 notes）
  author: string; // 作者名（旧 creator）

  // 旧スキーマ（互換性のため維持、将来的に削除）
  /** @deprecated Use category instead */
  attribute: string;
  /** @deprecated Use comment instead */
  notes: string;
  /** @deprecated Use author instead */
  creator: string;

  avatarUrl: string; // 旧互換URL（当面は sourceUrl と同値を保持）
  isFavorite?: boolean; // お気に入りフラグ（クライアント側）
  parsedCategory?: string[]; // 事前パース済みカテゴリ（クライアント最適化）
  parsedAuthor?: string[]; // 事前パース済み作者（クライアント最適化）
}

/**
 * フィルターオプション
 */
export interface AkyoFilterOptions {
  searchQuery?: string;
  category?: string; // 新フィールド
  categories?: string[]; // 複数カテゴリ
  categoryMatchMode?: "or" | "and"; // 複数カテゴリ一致条件
  author?: string; // 新フィールド
  authors?: string[]; // 複数作者（将来互換）
  randomCount?: number;
  favoritesOnly?: boolean;
  entryTypeFilter?: AkyoEntryType; // アバター/ワールド種別フィルタ

  /** @deprecated Use category instead */
  attribute?: string;
  /** @deprecated Use author instead */
  creator?: string;
}

/**
 * ビューモード
 */
export type ViewMode = "grid" | "list";

/**
 * 認証レベル
 */
export type AdminRole = "owner" | "admin";

export type AuthRole = AdminRole | null;

/**
 * VRChat アバター情報
 */
export interface VRChatAvatarInfo {
  avatarName: string;
  creatorName: string;
  description: string;
  fullTitle: string;
  avtr: string;
}
