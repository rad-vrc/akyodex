'use client';

/**
 * Akyo Detail Modal Component
 *
 * Complete recreation of original modal from index.html
 * Features:
 * - Header with gradient background
 * - Profile icon + ID + name
 * - Pre-generated reference sheets on grid-paper background, with original/card fallbacks
 * - Info grid (4 sections: name, avatar, creator, attributes)
 * - VRChat URL section
 * - Notes section (if available)
 * - Action buttons (favorite + VRChat link)
 */

import {
  IconExternalLink,
  IconGift,
  IconGlobe,
  IconHeart,
  IconHeartOutline,
  IconSparkles,
  IconTag,
  IconUser,
} from '@/components/icons';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { ensureContrastForWhiteText, getCategoryColor, parseAndSortCategories } from '@/lib/akyo-data-helpers';
import { formatDisplayId, getAkyoSourceUrl, getDisplaySerial, resolveEntryType } from '@/lib/akyo-entry';
import type { SupportedLanguage } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import {
  getReferenceImageIdentity,
  getReferenceImageUrls,
  type ReferenceImageUrls,
} from '@/lib/reference-image';
import { buildAvatarImageUrl } from '@/lib/vrchat-utils';
import type { AkyoData } from '@/types/akyo';
import Image from 'next/image';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReferenceImageViewer } from './reference-image-viewer';

/**
 * Props for the AkyoDetailModal component
 */
interface AkyoDetailModalProps {
  /** The Akyo data object to display, or null if no detail is selected */
  akyo: AkyoData | null;
  /** Whether the modal is currently visible */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Optional callback when the favorite heart is clicked */
  onToggleFavorite?: (id: string) => void;
  /** Currently selected language for translations (default: 'ja') */
  lang?: SupportedLanguage;
  /** Element to restore focus to after closing the modal */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Whether this entry is missing details because the complete catalog could not be loaded */
  isPreviewDetailUnavailable?: boolean;
}

/**
 * AkyoDetailModal Component
 * A full-screen overlay modal displaying detailed information about a specific Akyo.
 * Includes a large image preview with zoom functionality, metadata grid, and external links.
 *
 * @param props - Component properties
 * @returns Modal element with backdrop
 */
export function AkyoDetailModal({
  akyo,
  isOpen,
  onClose,
  onToggleFavorite,
  lang = 'ja',
  returnFocusRef,
  isPreviewDetailUnavailable = false,
}: AkyoDetailModalProps) {
  const [localAkyo, setLocalAkyo] = useState<AkyoData | null>(akyo);
  const sourceUrl = localAkyo ? getAkyoSourceUrl(localAkyo) : undefined;
  const safeSourceUrl = useMemo(() => {
    if (!sourceUrl) return null;

    try {
      const parsed = new URL(sourceUrl);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        parsed.hostname.toLowerCase() === 'vrchat.com'
      ) {
        return parsed.toString();
      }
    } catch {
      return null;
    }

    return null;
  }, [sourceUrl]);

  // 事前生成WebP優先、原本PNG・カード画像フォールバック用の状態
  // Note: Hooks はすべて早期リターンの前に配置する必要がある (React Hooks ルール)
  const r2Base = process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com';
  const referenceR2Base =
    process.env.NEXT_PUBLIC_REFERENCE_R2_BASE || `${r2Base.replace(/\/+$/, '')}/reference`;
  // Worlds reuse the 512px catalog card thumbnail instead of fetching another size.
  const cardImageUrl = localAkyo
    ? buildAvatarImageUrl(localAkyo.id, sourceUrl, resolveEntryType(localAkyo) === 'world' ? 512 : 800)
    : '';
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Sync local state with prop changes
  useEffect(() => {
    setLocalAkyo(akyo);
  }, [akyo]);

  const referenceImageUrls = useMemo<ReferenceImageUrls | null>(() => {
    if (!localAkyo || resolveEntryType(localAkyo) === 'world') {
      return null;
    }
    return getReferenceImageUrls({
      cardUrl: cardImageUrl,
      originalBaseUrl: r2Base,
      referenceBaseUrl: referenceR2Base,
      serial: getDisplaySerial(localAkyo),
    });
  }, [localAkyo, r2Base, referenceR2Base, cardImageUrl]);

  // body スクロールロック・初期フォーカス・Tab の循環・Escape・閉じた後の復帰は共有フックに任せる。
  // 復帰先は呼び出し側の returnFocusRef（開くきっかけになったカードなど）
  useModalDialog({
    isOpen,
    onRequestClose: onClose,
    dialogRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef,
  });

  // 早期リターン - すべての Hooks 呼び出しの後に配置
  if (!localAkyo || !isOpen) return null;

  // 新旧フィールド対応
  const categoryStr = localAkyo.category || localAkyo.attribute || '';
  const authorStr = localAkyo.author || localAkyo.creator || '';
  const commentStr = localAkyo.comment || localAkyo.notes || '';
  const displayName = localAkyo.nickname || localAkyo.avatarName || '';
  const categories: string[] = categoryStr
    ? parseAndSortCategories(categoryStr)
    : [];
  const isWorldEntry = resolveEntryType(localAkyo) === 'world';
  const handleBackdropClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // モーダル外（backdrop または modal container）をクリックしたら閉じる
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleFavoriteClick = () => {
    if (!localAkyo) return;

    // 楽観的更新（即座にUIを変更）
    // Note: お気に入りはlocalStorageベースで同期的に処理されるため、
    // エラーハンドリングやロールバックは不要です。
    // もし将来サーバーサイドAPIを使用する場合は、try-catchと
    // 失敗時のロールバック処理を追加してください。
    setLocalAkyo({
      ...localAkyo,
      isFavorite: !localAkyo.isFavorite,
    });

    // 親コンポーネントに通知（localStorageを更新）
    onToggleFavorite?.(localAkyo.id);
  };

  const handleVRChatOpen = () => {
    if (safeSourceUrl) {
      window.open(safeSourceUrl, '_blank', 'noopener,noreferrer');
    } else if (sourceUrl) {
      console.error('Invalid URL:', sourceUrl);
      alert('無効なURLです');
    }
  };

  return (
    <div className="modal-overlay fixed inset-0 z-50 overflow-y-auto" onClick={handleBackdropClick}>
      {/* Backdrop - クリックで閉じる */}
      <div
        className="modal-backdrop fixed inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={handleBackdropClick}
      />

      {/* Modal Container - クリックで閉じる */}
      <div className="relative min-h-screen px-4 py-8" onClick={handleBackdropClick}>
        <div className="relative mx-auto max-w-2xl">
          <div
            ref={dialogRef}
            className="bg-white rounded-3xl shadow-2xl modal-show"
            role="dialog"
            aria-modal="true"
            aria-labelledby="akyo-detail-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button — 白ベタ丸+ブランドピンクのX（トイUIの押しボタン）。
                装飾アクセントだった旧X線#6b5b7b（紫グレー）を撤去
                （名前カードの淡いto-purple-50は選定どおり意図的に維持） */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="group absolute top-4 right-4 w-12 h-12 rounded-full z-[60] flex items-center justify-center transition-all duration-300 hover:scale-110 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.16)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.22)]"
              aria-label={t('modal.close', lang)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                className="transition-transform duration-300 group-hover:rotate-90"
              >
                <path
                  d="M18 6L6 18M6 6L18 18"
                  stroke="#ee4180"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {/* Modal Header */}
            <div
              className="rounded-t-3xl p-6 border-b-4 border-dotted"
              style={{
                // サイトヘッダーと同じピンク→オレンジ系。白文字のWCAG AA(大文字3:1)を
                // 満たすためブランド原色より約1段深い値を使用（#ee4180=3.4:1, #ef6c52=3.0:1）
                background: 'linear-gradient(135deg, #ee4180, #ef6c52)',
                borderBottomColor: 'rgba(255, 255, 255, 0.85)',
              }}
            >
              {/* pr-12: 右上の閉じるボタン(right-4 + 48px)の下にタイトルが潜り込まないよう余白を確保。
                  spanのmin-w-0はflex子のmin-width:autoを打ち消すために必須で、
                  これが無いと320px幅+長タイトルで文字が余白を突き破ってボタンに重なる */}
              <h2 id="akyo-detail-modal-title" className="text-3xl font-black flex items-center text-white pr-12">
                {/* -translate-y-[3.5px]: profileIcon.webpは絵柄が画像内で下寄り
                    （インク分布y=55〜304/305px、中心58.9%）のため、配置は中央揃いでも
                    視覚的に下がって見える。実測分を上へ補正 */}
                <Image
                  src="/images/profileIcon.webp"
                  alt=""
                  width={40}
                  height={40}
                  className="w-10 h-10 mr-3 inline-block object-cover rounded-full -translate-y-[3.5px]"
                  unoptimized
                />
                <span className="min-w-0 flex-1 break-words">
                  {formatDisplayId(localAkyo)} {displayName}
                </span>
              </h2>
            </div>

            {/* Modal Content */}
            <div className="p-6 bg-gradient-to-b from-white to-blue-50">
              <div className="space-y-6">
                {/* Image Section with Zoom & Drag */}
                <ReferenceImageViewer
                  key={getReferenceImageIdentity({
                    id: localAkyo.id,
                    entryType: resolveEntryType(localAkyo),
                    serial: getDisplaySerial(localAkyo),
                    cardUrl: cardImageUrl,
                    urls: referenceImageUrls,
                  })}
                  displayName={displayName}
                  lang={lang}
                  cardUrl={cardImageUrl}
                  referenceImageUrls={referenceImageUrls}
                />

                {/* Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name Card — ワールドは正式名称なので「ニックネーム」でなく
                      「ワールド名」+地球儀（フィルターUIと同じアイコン言語）で示す。
                      ワールドはアバター名カードが無く3枚になるため、先頭のこのカードを
                      全幅にして、2段目を つくったひと｜カテゴリ の並びに保つ */}
                  <div
                    className={`bg-gradient-to-br from-pink-50 to-purple-50 rounded-2xl p-4 ${
                      isWorldEntry ? 'md:col-span-2' : ''
                    }`}
                  >
                    <h3 className="text-sm font-bold mb-2" style={{ color: '#FF6B9D' }}>
                      {isWorldEntry ? (
                        <IconGlobe size="w-3.5 h-3.5" className="mr-1" />
                      ) : (
                        <IconTag size="w-3.5 h-3.5" className="mr-1" />
                      )}
                      {t(isWorldEntry ? 'modal.worldName' : 'modal.name', lang)}
                    </h3>
                    <p className="text-xl font-bold">{localAkyo.nickname || '-'}</p>
                  </div>

                  {!isWorldEntry && (
                    <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-4">
                      <h3 className="text-sm font-bold text-blue-600 mb-2">
                        <Image
                          src="/images/profileIcon.webp"
                          alt=""
                          width={14}
                          height={14}
                          className="w-3.5 h-3.5 mr-1 inline-block rounded-full object-cover"
                          style={{ filter: 'brightness(0) invert(39%) sepia(85%) saturate(1800%) hue-rotate(196deg) brightness(96%)', transform: 'translateY(-2px) scale(1.18)' }}
                          unoptimized
                        />
                        {t('modal.avatarName', lang)}
                      </h3>
                      <p className="text-xl font-bold">{localAkyo.avatarName || '-'}</p>
                    </div>
                  )}

                  {/* Author Card — 名前・作者の「誰の何か」を先に、属性はその後。
                      一覧カードで作者の下にカテゴリを置いた並びと揃える */}
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4">
                    <h3 className="text-sm font-bold text-green-600 mb-2">
                      <IconUser size="w-3.5 h-3.5" className="mr-1" />
                      {t('modal.author', lang)}
                    </h3>
                    <p className="text-xl font-bold">{authorStr || ''}</p>
                  </div>

                  {/* Categories Card — 件数で高さが変わるので最後（右下）に置く */}
                  <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-2xl p-4">
                    <h3 className="text-sm font-bold text-orange-600 mb-2">
                      <IconSparkles size="w-3.5 h-3.5" className="mr-1" />
                      {t('modal.category', lang)}
                    </h3>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {categories.map((cat, index) => {
                        const color = getCategoryColor(cat);
                        const bgColor = ensureContrastForWhiteText(color);
                        return (
                          <span
                            key={index}
                            className="px-3 py-1 rounded-full text-sm font-bold text-white shadow-md"
                            style={{
                              // 単色ベタ塗り。旧`${bgColor}dd`への半透明グラデは末端が
                              // 白と混ざり、補正の白文字4.5:1保証が実表示で3.7〜3.9台に
                              // 割れていた（WCAG 1.4.3違反）ため廃止
                              background: bgColor,
                            }}
                          >
                            {cat}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {isPreviewDetailUnavailable && (
                  <p
                    role="status"
                    className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    {t('modal.previewUnavailable', lang)}
                  </p>
                )}

                {/* VRChat URL Section */}
                {safeSourceUrl && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">
                      {t(isWorldEntry ? 'modal.vrchatWorldUrl' : 'modal.vrchatUrl', lang)}
                    </h3>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <a
                        href={safeSourceUrl}
                        onClick={(e) => {
                          e.preventDefault();
                          handleVRChatOpen();
                        }}
                        className="text-blue-600 hover:text-blue-800 focus-visible:text-blue-800 text-sm underline decoration-1 underline-offset-2 break-all cursor-pointer"
                      >
                        <IconExternalLink size="w-3.5 h-3.5" className="mr-1" />
                        {safeSourceUrl}
                      </a>
                    </div>
                  </div>
                )}

                {/* BOOTH URL Section */}
                {localAkyo.boothUrl && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">
                      {t('modal.boothUrl', lang)}
                    </h3>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <a
                        href={localAkyo.boothUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 focus-visible:text-blue-800 text-sm underline decoration-1 underline-offset-2 break-all cursor-pointer"
                      >
                        <IconExternalLink size="w-3.5 h-3.5" className="mr-1" />
                        {localAkyo.boothUrl}
                      </a>
                    </div>
                  </div>
                )}

                {/* Notes/Comment Section */}
                {/* 額縁はピンク→オレンジ方向の超淡色グラデ。到達点はpink-50とorange-50の
                    中間色で止め、情報カード群（隣接色相ペア）と同じ穏やかな変化量に揃える */}
                {commentStr && (
                  <div className="bg-gradient-to-br from-pink-50 to-[#fef4f3] rounded-3xl p-5">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">
                      <IconGift size="w-4 h-4" className="mr-2" />
                      {t('modal.bonus', lang)}
                    </h3>
                    <div className="bg-white bg-opacity-80 rounded-2xl p-4 shadow-inner">
                      {/* 試行: おまけ本文にもサイト書体(M PLUS 2)を適用（コメント文字はサブセット収録済み） */}
                      <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {commentStr}
                      </p>
                    </div>
                  </div>
                )}

                {/* Action Buttons — 狭幅+iOSの文字サイズ設定(Dynamic Type)でも
                    はみ出さないよう、横パディングを確保しつつ max-sm で文字と
                    隙間を一段詰める。それでも溢れる場合は中央揃えのまま折り返す */}
                <div className="flex gap-3 max-sm:gap-2 pt-4 border-t">
                  {/* Favorite Button - ピンク色 */}
                  <button
                    type="button"
                    onClick={handleFavoriteClick}
                    className={`flex-1 min-w-0 py-3 px-2 max-sm:px-1 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 max-sm:gap-1.5 max-sm:text-sm ${localAkyo.isFavorite
                        ? 'text-white hover:opacity-90'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    style={
                      localAkyo.isFavorite
                        ? {
                          background: 'linear-gradient(135deg, #FF6B9D, #FF8FA3)',
                        }
                        : undefined
                    }
                    aria-label={
                      localAkyo.isFavorite
                        ? t('modal.favorite.remove', lang)
                        : t('modal.favorite.add', lang)
                    }
                  >
                    {localAkyo.isFavorite
                      ? <IconHeart size="w-4 h-4" className="shrink-0" />
                      : <IconHeartOutline size="w-4 h-4" className="shrink-0" />}
                    {/* 明示spanでmin-w-0: 匿名flex itemのままだとmin-content幅が
                        縮まず、200%文字拡大時に長い英語ラベルがはみ出す(WCAG 1.4.4) */}
                    <span className="min-w-0 text-center [overflow-wrap:anywhere]">
                      {localAkyo.isFavorite
                        ? t('modal.favorite.remove', lang)
                        : t('modal.favorite.add', lang)}
                    </span>
                  </button>

                  {/* VRChat Button - Orange Gradient (not purple!) */}
                  {safeSourceUrl && (
                    <button
                      type="button"
                      onClick={handleVRChatOpen}
                      className="flex-1 min-w-0 py-3 px-2 max-sm:px-1 rounded-lg font-medium transition-all flex items-center justify-center gap-2 max-sm:gap-1.5 max-sm:text-sm hover:brightness-110 hover:shadow-md"
                      style={{
                        background: 'linear-gradient(135deg, #f97316, #fb923c)',
                        color: 'white',
                      }}
                      aria-label={t('modal.vrchatOpen', lang)}
                    >
                      <IconExternalLink size="w-4 h-4" className="shrink-0" />
                      <span className="min-w-0 text-center [overflow-wrap:anywhere]">
                        {t('modal.vrchatOpen', lang)}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
