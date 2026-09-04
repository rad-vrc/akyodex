'use client';

import { t, type SupportedLanguage } from '@/lib/i18n';
import {
  getInitialReferenceImageStage,
  getNextReferenceImageStage,
  resolveReferenceImageUrl,
  type ReferenceImageStage,
  type ReferenceImageUrls,
} from '@/lib/reference-image';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';

interface ReferenceImageViewerProps {
  displayName: string;
  lang: SupportedLanguage;
  cardUrl: string;
  referenceImageUrls: ReferenceImageUrls | null;
}

// Mounted only inside an open modal. Its key covers every image URL, not favorite state.
export function ReferenceImageViewer({
  displayName, lang, cardUrl, referenceImageUrls,
}: ReferenceImageViewerProps) {
  const [imageMounted, setImageMounted] = useState(false);
  useEffect(() => {
    // Concurrent rendering can set an image src in an abandoned tree before commit.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start image I/O only in the committed viewer
    setImageMounted(true);
  }, []);
  const [imageStage, setImageStage] = useState<ReferenceImageStage>(() =>
    referenceImageUrls ? getInitialReferenceImageStage(referenceImageUrls) : 'card'
  );
  const imageUrl = referenceImageUrls
    ? resolveReferenceImageUrl(imageStage, referenceImageUrls)
    : imageStage === 'card' ? cardUrl : null;
  const imageDimensions = imageStage === 'card'
    ? { width: 800, height: 533 }
    : imageStage === 'zoom' ? { width: 1920, height: 1080 } : { width: 960, height: 540 };
  const [zoomImageRequested, setZoomImageRequested] = useState(false);
  const [zoomImageReady, setZoomImageReady] = useState(false);
  const [zoomImageFailed, setZoomImageFailed] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const originStartRef = useRef({ x: 50, y: 50 });
  const lastTapRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const justZoomedOutRef = useRef(false);
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DOUBLE_TAP_DELAY = 300;
  const DRAG_THRESHOLD = 5;

  useEffect(() => () => {
    if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current);
  }, []);

  // ズーム画像が実際に見えている間だけ 960px を視覚的に隠す。両方を不透明のまま重ねると、
  // 半透明部分が二重に合成されて線が濃く・ぼやける。読み込み中と失敗時とズーム解除後は
  // 960px を表示したままにし、代替テキストのために DOM からは外さない（opacity のみ）。
  const zoomOverlayVisible =
    Boolean(referenceImageUrls?.zoom) &&
    zoomImageRequested &&
    imageStage === 'preview' &&
    isZoomed &&
    zoomImageReady;

  const isReferenceImage = referenceImageUrls !== null;
  const handleImageError = useCallback(() => {
    setImageStage((current) => isReferenceImage ? getNextReferenceImageStage(current) : 'unavailable');
  }, [isReferenceImage]);
  const handleZoomLoad = useCallback(() => setZoomImageReady(true), []);
  const handleZoomError = useCallback(() => {
    setZoomImageRequested(false);
    setZoomImageReady(false);
    setZoomImageFailed(true);
  }, []);

  const zoomIn = useCallback((origin: { x: number; y: number }) => {
    setZoomOrigin(origin);
    setIsZoomed(true);
    if (referenceImageUrls?.zoom && imageStage === 'preview' && !zoomImageFailed) {
      setZoomImageRequested(true);
    }
  }, [imageStage, referenceImageUrls?.zoom, zoomImageFailed]);

  // シングルクリックでズームイン（クリック位置を中心に）
  const handleImageClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // ドラッグ中やズーム中はクリックとして扱わない
      if (isDragging || isZoomed) return;

      // ダブルタップでズーム解除した直後のclickイベントは無視（再ズーム防止）
      if (justZoomedOutRef.current) {
        justZoomedOutRef.current = false;
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      // ズームイン：クリック位置を中心に
      zoomIn({ x, y });
    },
    [isZoomed, isDragging, zoomIn]
  );

  const handleImageKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (isZoomed) {
          setIsZoomed(false);
          return;
        }

        zoomIn({ x: 50, y: 50 });
        return;
      }

      if (!isZoomed) {
        return;
      }

      const step = 10;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setZoomOrigin((current) => ({ ...current, x: Math.max(0, current.x - step) }));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setZoomOrigin((current) => ({ ...current, x: Math.min(100, current.x + step) }));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setZoomOrigin((current) => ({ ...current, y: Math.max(0, current.y - step) }));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setZoomOrigin((current) => ({ ...current, y: Math.min(100, current.y + step) }));
      }
    },
    [isZoomed, zoomIn]
  );

  // ダブルクリックでズームアウト
  const handleImageDoubleClick = useCallback(() => {
    if (isZoomed) {
      setIsZoomed(false);
    }
  }, [isZoomed]);

  // ドラッグ開始（マウス）
  const handleDragStart = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isZoomed) return;
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      originStartRef.current = { ...zoomOrigin };
    },
    [isZoomed, zoomOrigin]
  );

  // ドラッグ開始（タッチ）
  const handleTouchStart = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      if (!isZoomed || e.touches.length !== 1) return;
      // ネイティブスクロールを防止
      e.preventDefault();
      setIsDragging(true);
      hasDraggedRef.current = false; // ドラッグ開始時はまだ移動していない
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      originStartRef.current = { ...zoomOrigin };
    },
    [isZoomed, zoomOrigin]
  );

  // ドラッグ中（マウス）
  const handleDragMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isDragging || !isZoomed) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const deltaX = ((e.clientX - dragStartRef.current.x) / rect.width) * 100;
      const deltaY = ((e.clientY - dragStartRef.current.y) / rect.height) * 100;

      // ドラッグ方向と逆に origin を移動（自然な操作感）
      const newX = Math.max(0, Math.min(100, originStartRef.current.x - deltaX));
      const newY = Math.max(0, Math.min(100, originStartRef.current.y - deltaY));

      setZoomOrigin({ x: newX, y: newY });
    },
    [isDragging, isZoomed]
  );

  // ドラッグ中（タッチ）
  const handleTouchMove = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      if (!isDragging || !isZoomed || e.touches.length !== 1) return;

      // ネイティブスクロールを防止
      e.preventDefault();
      e.stopPropagation();

      const touchX = e.touches[0].clientX;
      const touchY = e.touches[0].clientY;

      // 移動量がしきい値を超えたらドラッグとみなす
      const movedX = Math.abs(touchX - dragStartRef.current.x);
      const movedY = Math.abs(touchY - dragStartRef.current.y);
      if (movedX > DRAG_THRESHOLD || movedY > DRAG_THRESHOLD) {
        hasDraggedRef.current = true;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const deltaX = ((touchX - dragStartRef.current.x) / rect.width) * 100;
      const deltaY = ((touchY - dragStartRef.current.y) / rect.height) * 100;

      const newX = Math.max(0, Math.min(100, originStartRef.current.x - deltaX));
      const newY = Math.max(0, Math.min(100, originStartRef.current.y - deltaY));

      setZoomOrigin({ x: newX, y: newY });
    },
    [isDragging, isZoomed]
  );

  // ドラッグ終了（マウス用）
  const handleDragEnd = useCallback(() => {
    // 少し遅延させてクリックイベントとの競合を防ぐ
    if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current);
    dragEndTimerRef.current = setTimeout(() => setIsDragging(false), 50);
  }, []);

  // タッチ終了（ダブルタップ検出付き）
  const handleTouchEnd = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    // ズーム中のみダブルタップ判定を行う
    if (isZoomed) {
      if (!hasDraggedRef.current && timeSinceLastTap < DOUBLE_TAP_DELAY) {
        // ダブルタップでズームアウト
        setIsZoomed(false);
        lastTapRef.current = 0;
        justZoomedOutRef.current = true; // 直後のclickイベントをブロックするためのフラグ
      } else if (!hasDraggedRef.current) {
        // ズーム中のタップのみ、タップ時刻を記録
        lastTapRef.current = now;
      }
    }
    // 非ズーム時は lastTapRef を更新しない（ズームイン→即ダブルタップ判定を防ぐ）

    // ドラッグ状態をリセット
    setIsDragging(false);
    hasDraggedRef.current = false;
  }, [isZoomed]);

  return (
    <div className="relative">
      <div
        className={`h-64 overflow-hidden rounded-3xl bg-white p-2 select-none ${isZoomed ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
        style={{
          touchAction: isZoomed ? 'none' : 'auto',
          // 三面図の背景は方眼紙（白地+極薄グリッド）。「三面図=設計資料」の
          // メタファーで、枠線はレイアウトを変えないinset影で描く
          backgroundImage:
            'linear-gradient(#eef2f6 1px, transparent 1px), linear-gradient(90deg, #eef2f6 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          boxShadow: 'inset 0 0 0 1px #e2e8f0',
          // フォーカス表示はグローバルCSSの3px outline（[tabindex="0"]:focus-visible）
          // に任せ、色だけ方眼と同系のslate-500へ（白背景4.76:1・方眼#eef2f6に
          // 4.23:1でWCAG 1.4.11の3:1を満たす。slate-400は2.56:1で不適合）。
          // Tailwindのringはこのinset影のインラインbox-shadowに上書きされて
          // 描画されないため使わない
          outlineColor: '#64748b',
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isZoomed}
        aria-roledescription={t('modal.imageViewerRoleDescription', lang)}
        aria-label={
          isZoomed
            ? `${displayName} ${t('modal.imageMoveZoom', lang)}`
            : `${displayName} ${t('modal.imageZoomControl', lang)}`
        }
        onClick={handleImageClick}
        onKeyDown={handleImageKeyDown}
        onDoubleClick={handleImageDoubleClick}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`w-full h-full relative ${isDragging ? '' : 'transition-transform duration-300 ease-out'}`}
          style={{
            transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
            transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
          }}
        >
          {imageMounted && imageUrl && (
            <Image
              key={imageUrl}
              src={imageUrl}
              alt={displayName}
              width={imageDimensions.width}
              height={imageDimensions.height}
              data-reference-primary-image
              className={`w-full h-full object-contain rounded-2xl ${zoomOverlayVisible ? 'opacity-0' : ''}`}
              unoptimized
              loading="eager"
              fetchPriority="high"
              draggable={false}
              onError={handleImageError}
            />
          )}
          {imageMounted && referenceImageUrls?.zoom && zoomImageRequested && imageStage === 'preview' && (
            <Image
              src={referenceImageUrls.zoom}
              alt=""
              role="presentation"
              aria-hidden="true"
              data-reference-zoom-image
              width={1920}
              height={1080}
              className={`absolute inset-0 w-full h-full object-contain rounded-2xl ${zoomOverlayVisible ? 'opacity-100' : 'opacity-0'}`}
              unoptimized
              loading="eager"
              fetchPriority="high"
              draggable={false}
              onLoad={handleZoomLoad}
              onError={handleZoomError}
            />
          )}
        </div>
      </div>

      {/* Zoom/Drag Hint — 三面図と重ならないよう右上（旧キラキラ位置）に表示 */}
      {!isZoomed ? (
        <div className="absolute top-4 right-4 bg-black/50 text-white text-xs px-3 py-1 rounded-full pointer-events-none">
          {t('modal.zoomHint', lang)}
        </div>
      ) : (
        <div className="absolute top-4 right-4 bg-black/50 text-white text-xs px-3 py-1 rounded-full pointer-events-none">
          {t('modal.dragHint', lang)}
        </div>
      )}
    </div>
  );
}
