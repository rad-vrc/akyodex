'use client';

/* eslint-disable @next/next/no-img-element */

import { IconClose, IconCloudUpload, IconCrop, IconEdit, IconRedo, IconSave, IconSearch, IconTag, IconTags, IconZoomIn, IconZoomOut } from '@/components/icons';
import {
  detectVrcEntryTypeFromUrl,
  ensureWorldCategory,
  extractVRChatAvatarIdFromUrl,
  getAkyoSourceUrl,
  resolveDisplaySerialForSourceUrlChange,
  shouldResetWorldMetadata,
} from '@/lib/akyo-entry';
import type { AkyoData } from '@/types/akyo';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AttributeModal } from './attribute-modal';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  akyo: AkyoData | null;
  // 新フィールド
  categories?: string[];
  // 旧フィールド（互換性）
  attributes: string[];

  onSuccess: () => void;
}

function normalizeCategoriesForSubmit(
  categories: string[],
  entryType: 'avatar' | 'world'
): string[] {
  const normalized = categories
    .map((category) => category.trim())
    .filter(Boolean);

  return entryType === 'world'
    ? ensureWorldCategory(normalized)
    : Array.from(new Set(normalized));
}

/**
 * Edit Modal Component
 * Akyoデータの編集モーダル（元のadmin.htmlを完全再現）
 */
export function EditModal({
  isOpen,
  onClose,
  akyo,
  categories,
  attributes,
  onSuccess,
}: EditModalProps) {
  const [formData, setFormData] = useState({
    entryType: 'avatar' as 'avatar' | 'world',
    displaySerial: '',
    nickname: '',
    avatarName: '',
    // UI上は複数選択UIを維持するため配列で扱う
    categories: [] as string[],
    author: '',
    sourceUrl: '',
    avatarUrl: '',
    boothUrl: '',
    comment: '',
  });

  const [showAttributeModal, setShowAttributeModal] = useState(false);
  const [fetchingName, setFetchingName] = useState(false);
  const [fetchingImage, setFetchingImage] = useState(false);

  // Image cropping states
  // ... (省略: 変更なし) ...
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [imageScale, setImageScale] = useState(1);
  const [imageX, setImageX] = useState(0);
  const [imageY, setImageY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Duplicate check states
  // ... (省略: 変更なし) ...
  const [nicknameStatus, setNicknameStatus] = useState<{
    message: string;
    tone: 'neutral' | 'success' | 'error';
  }>({ message: '', tone: 'neutral' });
  const [avatarNameStatus, setAvatarNameStatus] = useState<{
    message: string;
    tone: 'neutral' | 'success' | 'error';
  }>({ message: '', tone: 'neutral' });
  const [checkingNickname, setCheckingNickname] = useState(false);
  const [checkingAvatarName, setCheckingAvatarName] = useState(false);

  // Initialize form data when akyo changes
  useEffect(() => {
    if (akyo) {
      // 新旧フィールド対応
      const categoryStr = akyo.category || akyo.attribute || '';
      const authorStr = akyo.author || akyo.creator || '';
      const commentStr = akyo.comment || akyo.notes || '';

      const resolvedEntryType =
        akyo.entryType || detectVrcEntryTypeFromUrl(getAkyoSourceUrl(akyo)) || 'avatar';

      setFormData({
        entryType: resolvedEntryType,
        displaySerial: akyo.displaySerial || (resolvedEntryType === 'world' ? '' : akyo.id),
        nickname: akyo.nickname || '',
        avatarName: akyo.avatarName || '',
        categories: normalizeCategoriesForSubmit(
          categoryStr ? categoryStr.split(/[、,]/).map(a => a.trim()) : [],
          resolvedEntryType
        ),
        author: authorStr,
        sourceUrl: getAkyoSourceUrl(akyo),
        avatarUrl: akyo.avatarUrl || getAkyoSourceUrl(akyo),
        boothUrl: akyo.boothUrl || '',
        comment: commentStr,
      });
      setShowImagePreview(false);
      setOriginalImageSrc(null);
      setNicknameStatus({ message: '', tone: 'neutral' });
      setAvatarNameStatus({ message: '', tone: 'neutral' });
    }
  }, [akyo]);

  // ... (画像処理系ロジックは変更なし) ...
  // Update image transform when position or scale changes
  useEffect(() => {
    const img = cropImageRef.current;
    if (img) {
      img.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageScale})`;
    }
  }, [imageX, imageY, imageScale]);

  // Image cropping functions (matching original implementation)
  const resetImagePosition = () => {
    setImageScale(1);
    const container = cropContainerRef.current;
    const img = cropImageRef.current;
    if (container && img) {
      const cw = container.offsetWidth;
      const ch = container.offsetHeight;
      const iw = img.offsetWidth;
      const ih = img.offsetHeight;
      setImageX((cw - iw) / 2);
      setImageY((ch - ih) / 2);
    } else {
      setImageX(0);
      setImageY(0);
    }
  };

  const isWorldEntry = formData.entryType === 'world';

  const zoomImage = (factor: number) => {
    setImageScale(prev => {
      const newScale = prev * factor;
      return Math.max(0.5, Math.min(3, newScale));
    });
  };

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const imgSrc = e.target?.result as string;
      setOriginalImageSrc(imgSrc);
      setShowImagePreview(true);

      setTimeout(() => {
        const img = cropImageRef.current;
        const container = cropContainerRef.current;
        if (img && container) {
          img.onload = () => {
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            const imgAspect = img.naturalWidth / img.naturalHeight;
            const containerAspect = containerWidth / containerHeight;

            if (imgAspect > containerAspect) {
              img.style.height = containerHeight + 'px';
              img.style.width = 'auto';
            } else {
              img.style.width = containerWidth + 'px';
              img.style.height = 'auto';
            }

            const imgWidth = img.offsetWidth;
            const imgHeight = img.offsetHeight;
            setImageX((containerWidth - imgWidth) / 2);
            setImageY((containerHeight - imgHeight) / 2);
            setImageScale(1);
          };
        }
      }, 50);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handleImageFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - imageX,
      y: e.clientY - imageY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setImageX(e.clientX - dragStart.x);
      setImageY(e.clientY - dragStart.y);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomImage(delta);
  };

  const generateCroppedImage = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const container = cropContainerRef.current;
      const imgEl = cropImageRef.current;
      if (!container || !imgEl || !imgEl.src || !originalImageSrc) {
        resolve(null);
        return;
      }

      const canvasW = 300;
      const canvasH = 200;
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      const image = new Image();
      image.onload = () => {
        const cw = container.offsetWidth;
        const ch = container.offsetHeight;
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        const containerAspect = cw / ch;
        const imageAspect = iw / ih;

        const baseScale = imageAspect > containerAspect ? (ch / ih) : (cw / iw);
        const totalScale = baseScale * imageScale;

        const sx = Math.max(0, (-imageX) / totalScale);
        const sy = Math.max(0, (-imageY) / totalScale);
        const sw = Math.min(iw - sx, cw / totalScale);
        const sh = Math.min(ih - sy, ch / totalScale);

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvasW, canvasH);

        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          } else {
            resolve(null);
          }
        }, 'image/webp', 0.9);
      };
      image.onerror = () => {
        console.error('Failed to load image for cropping');
        resolve(null);
      };
      image.crossOrigin = 'anonymous';
      image.src = originalImageSrc;
    });
  };

  const handleInputChange = (field: string, value: string | string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSourceUrlChange = (value: string) => {
    const detectedEntryType = detectVrcEntryTypeFromUrl(value.trim());
    setFormData((prev) => ({
      ...prev,
      sourceUrl: value,
      avatarUrl: value,
      entryType: detectedEntryType ?? prev.entryType,
      ...(shouldResetWorldMetadata(prev.sourceUrl, value)
        ? { nickname: '', author: '' }
        : {}),
      displaySerial: resolveDisplaySerialForSourceUrlChange({
        currentDisplaySerial: prev.displaySerial,
        detectedEntryType,
        id: akyo?.id ?? prev.displaySerial,
        originalDisplaySerial: akyo?.displaySerial,
        originalEntryType: akyo?.entryType,
      }),
    }));
  };

  // ... (重複チェック系ロジックは変更なし) ...
  // Duplicate check for nickname
  const handleCheckNicknameDuplicate = async () => {
    const value = formData.nickname.trim();

    if (!value) {
      setNicknameStatus({
        message: '通称を入力してください',
        tone: 'neutral',
      });
      return;
    }

    setCheckingNickname(true);
    setNicknameStatus({ message: '', tone: 'neutral' });

    try {
      const response = await fetch('/api/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'nickname',
          value: value,
          excludeId: akyo?.id, // Exclude current akyo from duplicate check
        }),
      });

      if (!response.ok) {
        throw new Error('Duplicate check failed');
      }

      const data = await response.json();
      setNicknameStatus({
        message: data.message,
        tone: data.isDuplicate ? 'error' : 'success',
      });
    } catch (error) {
      console.error('Nickname duplicate check error:', error);
      setNicknameStatus({
        message: '重複チェックに失敗しました',
        tone: 'error',
      });
    } finally {
      setCheckingNickname(false);
    }
  };

  // Duplicate check for avatar name
  const handleCheckAvatarNameDuplicate = async () => {
    const value = formData.avatarName.trim();

    if (!value) {
      setAvatarNameStatus({
        message: 'アバター名を入力してください',
        tone: 'neutral',
      });
      return;
    }

    setCheckingAvatarName(true);
    setAvatarNameStatus({ message: '', tone: 'neutral' });

    try {
      const response = await fetch('/api/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'avatarName',
          value: value,
          excludeId: akyo?.id, // Exclude current akyo from duplicate check
        }),
      });

      if (!response.ok) {
        throw new Error('Duplicate check failed');
      }

      const data = await response.json();
      setAvatarNameStatus({
        message: data.message,
        tone: data.isDuplicate ? 'error' : 'success',
      });
    } catch (error) {
      console.error('Avatar name duplicate check error:', error);
      setAvatarNameStatus({
        message: '重複チェックに失敗しました',
        tone: 'error',
      });
    } finally {
      setCheckingAvatarName(false);
    }
  };

  // ... (VRChat連携ロジックは変更なし) ...
  // VRChat URLからアバター名を取得
  const handleFetchAvatarName = async () => {
    if (isWorldEntry) {
      alert('ワールドは通称欄を名称として使用します');
      return;
    }

    const url = formData.sourceUrl.trim();
    if (!url) {
      alert('VRChat URLを入力してください');
      return;
    }

    const avtrId = extractVRChatAvatarIdFromUrl(url);
    if (!avtrId) {
      alert('有効なVRChatアバターURLを入力してください\n例: https://vrchat.com/home/avatar/avtr_xxx...');
      return;
    }

    setFetchingName(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`/api/vrc-avatar-info?avtr=${avtrId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`アバター情報取得に失敗しました: ${response.status}`);
      }

      const data = await response.json();
      handleInputChange('avatarName', data.avatarName || '');

      setTimeout(() => setFetchingName(false), 1000);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('VRChatアバター名取得エラー:', error);

      if (error instanceof Error && error.name === 'AbortError') {
        alert('リクエストがタイムアウトしました。\nもう一度お試しください。');
      } else {
        alert('VRChatからアバター名を取得できませんでした。\nURLが正しいか、アバターが公開設定か確認してください。');
      }
      setFetchingName(false);
    }
  };

  // VRChat URLから画像を取得
  const handleFetchImage = async () => {
    if (isWorldEntry) {
      alert('ワールド画像は登録画面の自動取得を利用してください。必要なら手動で画像をアップロードしてください。');
      return;
    }

    const url = formData.sourceUrl.trim();
    if (!url) {
      alert('VRChat URLを入力してください');
      return;
    }

    const avtrId = extractVRChatAvatarIdFromUrl(url);
    if (!avtrId) {
      alert('有効なVRChatアバターURLを入力してください\n例: https://vrchat.com/home/avatar/avtr_xxx...');
      return;
    }

    setFetchingImage(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`/api/vrc-avatar-image?avtr=${avtrId}&w=1024`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`画像取得に失敗しました: ${response.status}`);
      }

      const blob = await response.blob();
      const file = new File([blob], `${avtrId}.webp`, { type: 'image/webp' });

      handleImageFile(file);

      setTimeout(() => setFetchingImage(false), 1000);
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('VRChat画像取得エラー:', error);

      if (error instanceof Error && error.name === 'AbortError') {
        alert('リクエストがタイムアウトしました。\nもう一度お試しください。');
      } else {
        alert('VRChatから画像を取得できませんでした。\nURLが正しいか、アバターが公開設定か確認してください。');
      }
      setFetchingImage(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!akyo) return;

    // Validate required fields
    if (!isWorldEntry && !formData.avatarName.trim()) {
      alert('アバター名は必須です');
      return;
    }
    if (isWorldEntry && !formData.nickname.trim()) {
      alert('ワールド名（通称）は必須です');
      return;
    }
    if (!formData.author.trim()) {
      alert('作者は必須です');
      return;
    }
    if (formData.categories.length === 0) {
      alert('カテゴリを1つ以上選択してください');
      return;
    }

    // Check for duplicates (excluding current akyo)
    if (nicknameStatus.tone === 'error' || avatarNameStatus.tone === 'error') {
      if (!confirm('重複する通称またはアバター名が検出されました。\n更新を続行しますか？')) {
        return;
      }
    }

    // Get form element and button BEFORE await

    const formEl = e.currentTarget as HTMLFormElement | null;
    if (!formEl) {
      console.error('Form element not found on submit');
      return;
    }


    const submitBtn = formEl.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    const originalText = submitBtn?.innerHTML || '';

    // Generate cropped image if available
    let croppedImageData: string | null = null;
    if (showImagePreview && originalImageSrc) {
      croppedImageData = await generateCroppedImage();
    }

    // Show loading state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⛳ 更新中...';
    }

    try {
      const submitData = new FormData();
      submitData.append('id', akyo.id);
      const normalizedCategories = normalizeCategoriesForSubmit(
        formData.categories,
        formData.entryType
      );
      const shouldClearDisplaySerialForWorldConversion =
        isWorldEntry && akyo.entryType !== 'world' && formData.displaySerial === akyo.id;
      const displaySerialForSubmit = shouldClearDisplaySerialForWorldConversion
        ? ''
        : formData.displaySerial;

      submitData.append('entryType', formData.entryType);
      submitData.append('displaySerial', displaySerialForSubmit);
      submitData.append('nickname', formData.nickname);
      submitData.append('avatarName', isWorldEntry ? '' : formData.avatarName);
      submitData.append('sourceUrl', formData.sourceUrl);
      submitData.append('avatarUrl', formData.avatarUrl || formData.sourceUrl);
      if (formData.boothUrl.trim()) {
        submitData.append('boothUrl', formData.boothUrl.trim());
      }

      // 新フィールド
      submitData.append('author', formData.author);
      submitData.append('category', normalizedCategories.join(','));
      submitData.append('comment', formData.comment);

      // 旧フィールド (互換性のため)
      submitData.append('creator', formData.author);
      submitData.append('attributes', normalizedCategories.join(','));
      submitData.append('notes', formData.comment);

      if (croppedImageData) {
        submitData.append('imageData', croppedImageData);
      }

      const response = await fetch('/api/update-akyo', {
        method: 'POST',
        body: submitData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'サーバーエラーが発生しました');
      }

      alert(
        `✅ ${result.message}\n\n` +
        `ID: #${akyo.id}\n` +
        `${isWorldEntry ? '名称' : 'アバター名'}: ${isWorldEntry ? formData.nickname : formData.avatarName}\n` +
        `作者: ${formData.author}\n\n` +
        (result.commitUrl ? `コミット: ${result.commitUrl}` : '')
      );

      onSuccess();
      onClose();

    } catch (error) {
      console.error('Form submission error:', error);
      alert(
        '❌ 更新に失敗しました\n\n' +
        (error instanceof Error ? error.message : '不明なエラーが発生しました') +
        '\n\nもう一度お試しください。'
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  };

  if (!isOpen || !akyo) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
      <div className="relative flex items-center justify-center min-h-screen p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center z-10">
            <h2 className="text-2xl font-bold flex items-center">
              <IconEdit size="w-5 h-5" className="text-blue-500 mr-2" />
              Akyoを編集
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <IconClose size="w-6 h-6" />
            </button>
          </div>

          <div className="p-6">
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ID（変更不可） */}
                <div>
                  <label htmlFor="edit-id" className="block text-gray-700 text-sm font-medium mb-1">
                    ID（変更不可）
                  </label>
                  <input
                    id="edit-id"
                    type="text"
                    value={akyo.id}
                    disabled
                    className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg font-mono font-bold"
                  />
                </div>

                {/* 通称 */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="edit-nickname" className="block text-gray-700 text-sm font-medium">
                      通称
                    </label>
                    <button
                      type="button"
                      onClick={handleCheckNicknameDuplicate}
                      disabled={checkingNickname}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-orange-200 text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkingNickname ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          確認中...
                        </>
                      ) : (
                        <>
                          <IconSearch size="w-4 h-4" />
                          同じ通称が既に登録されているか確認
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    id="edit-nickname"
                    type="text"
                    value={formData.nickname}
                    onChange={(e) => {
                      handleInputChange('nickname', e.target.value);
                      setNicknameStatus({ message: '', tone: 'neutral' });
                    }}
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: チョコミントAkyo"
                  />
                  {nicknameStatus.message && (
                    <p
                      className={`mt-2 text-sm ${
                        nicknameStatus.tone === 'error'
                          ? 'text-red-600'
                          : nicknameStatus.tone === 'success'
                          ? 'text-green-600'
                          : 'text-gray-600'
                      }`}
                    >
                      {nicknameStatus.message}
                    </p>
                  )}
                </div>

                {/* アバター名 */}
                <div>
                  <label
                    htmlFor={isWorldEntry ? 'edit-world-name-note' : 'edit-avatar-name'}
                    className="block text-gray-700 text-sm font-medium mb-1"
                  >
                    {isWorldEntry ? '名称' : 'アバター名'}
                  </label>
                  {isWorldEntry ? (
                    <input
                      id="edit-world-name-note"
                      type="text"
                      value="ワールドは「通称」欄を名称として使用します"
                      disabled
                      className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
                    />
                  ) : (
                    <>
                      <input
                        id="edit-avatar-name"
                        type="text"
                        value={formData.avatarName}
                        onChange={(e) => {
                          handleInputChange('avatarName', e.target.value);
                          setAvatarNameStatus({ message: '', tone: 'neutral' });
                        }}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="例: Akyo origin"
                      />
                      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCheckAvatarNameDuplicate}
                          disabled={checkingAvatarName}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-orange-200 text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {checkingAvatarName ? (
                            <>
                              <svg
                                className="w-3 h-3 animate-spin"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              確認中...
                            </>
                          ) : (
                            <>
                              <IconSearch size="w-4 h-4" />
                              同じアバター名が既に登録されているか確認
                            </>
                          )}
                        </button>
                        {avatarNameStatus.message && (
                          <p
                            className={`text-sm ${
                              avatarNameStatus.tone === 'error'
                                ? 'text-red-600'
                                : avatarNameStatus.tone === 'success'
                                ? 'text-green-600'
                                : 'text-gray-600'
                            }`}
                          >
                            {avatarNameStatus.message}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* カテゴリ (旧: 属性) */}
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-1">カテゴリ</label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowAttributeModal(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-100 text-green-800 border border-green-300 rounded-lg hover:bg-green-200 transition-colors"
                    >
                      <IconTags size="w-4 h-4" />
                      カテゴリを管理
                    </button>
                    <div className="border border-dashed border-green-200 rounded-lg bg-white/60 p-3 min-h-[60px]">
                      {formData.categories.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          選択されたカテゴリがここに表示されます
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {formData.categories.map((cat) => (
                            <span
                              key={cat}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full"
                            >
                              <IconTag size="w-3 h-3" />
                              {cat}
                            </span>
                          ))}
                        </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">
                      ワールドならワールドカテゴリは自動追加されますが、階層型カテゴリを設定する場合は手動で設定してください。
                    </p>
                  </div>
                </div>

                {/* 作者 */}
                <div>
                  <label htmlFor="edit-author" className="block text-gray-700 text-sm font-medium mb-1">
                    作者
                  </label>
                  <input
                    id="edit-author"
                    type="text"
                    value={formData.author}
                    onChange={(e) => handleInputChange('author', e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: ugai"
                  />
                </div>

                {/* VRChat URL */}
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
                    <label htmlFor="edit-source-url" className="text-gray-700 text-sm font-medium">
                      VRChat URL
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={handleFetchAvatarName}
                        disabled={fetchingName}
                        className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors duration-200 flex items-center gap-1.5 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isWorldEntry ? 'ワールドでは利用できません' : 'VRChat URLからアバター名を自動取得'}
                      >
                        {fetchingName ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>取得中...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                            <span>{isWorldEntry ? '名称自動取得は不要' : 'URLからアバター名を取得'}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleFetchImage}
                        disabled={fetchingImage}
                        className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors duration-200 flex items-center gap-1.5 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isWorldEntry ? 'ワールドでは既存URLからの画像再取得は非対応です' : 'VRChat URLから画像を自動取得'}
                      >
                        {fetchingImage ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>取得中...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            <span>{isWorldEntry ? 'ワールド画像は手動更新' : 'URLから画像を取得'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <input
                    id="edit-source-url"
                    type="url"
                    value={formData.sourceUrl}
                    onChange={(e) => {
                      handleSourceUrlChange(e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://vrchat.com/..."
                  />
                </div>
              </div>

              {/* BOOTH URL */}
              <div>
                <label htmlFor="edit-booth-url" className="block text-gray-700 text-sm font-medium mb-1">
                  BOOTH URL（任意）
                </label>
                <input
                  id="edit-booth-url"
                  type="url"
                  value={formData.boothUrl}
                  onChange={(e) => handleInputChange('boothUrl', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://booth.pm/ja/items/..."
                />
                <p className="text-xs text-gray-500 mt-2 leading-snug">
                  BOOTHの販売ページURLを入力すると、図鑑にBOOTHリンクボタンが表示されます。
                </p>
              </div>

              {/* おまけ情報（comment） */}
              <div>
                <label htmlFor="edit-comment" className="block text-gray-700 text-sm font-medium mb-1">
                  おまけ情報
                </label>
                <textarea
                  id="edit-comment"
                  value={formData.comment}
                  onChange={(e) => handleInputChange('comment', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Quest対応、特殊機能など"
                />
              </div>

              {/* 画像アップロード */}
              <div>
                <label htmlFor="edit-image-file" className="block text-gray-700 text-sm font-medium mb-1">
                  画像
                </label>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center"
                >
                  <IconCloudUpload size="w-10 h-10" className="text-gray-400 mb-2 mx-auto" />
                  <p className="text-gray-600">画像をドラッグ&ドロップ または</p>
                  <input
                    id="edit-image-file"
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    accept=".webp,.png,.jpg,.jpeg"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    ファイルを選択
                  </button>
                </div>

                {/* Image Cropping Preview */}
                {showImagePreview && (
                  <div className="mt-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-sm font-medium text-gray-700 mb-3">
                        <IconCrop size="w-4 h-4" className="mr-2" />画像のトリミング調整
                      </h3>

                      <div
                        ref={cropContainerRef}
                        className="relative mx-auto mb-4 overflow-hidden border-2 border-indigo-500 rounded-lg"
                        style={{ width: '300px', height: '200px' }}
                        onWheel={handleWheel}
                      >
                        <img
                          ref={cropImageRef}
                          src={originalImageSrc || ''}
                          alt="Crop preview"
                          onMouseDown={handleMouseDown}
                          onMouseMove={handleMouseMove}
                          onMouseUp={handleMouseUp}
                          onMouseLeave={handleMouseUp}
                          className="absolute cursor-move"
                          style={{
                            transform: `translate(${imageX}px, ${imageY}px) scale(${imageScale})`,
                            transformOrigin: 'center',
                          }}
                          draggable={false}
                        />
                      </div>

                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={resetImagePosition}
                          className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                        >
                          <IconRedo size="w-3.5 h-3.5" className="mr-1" /> リセット
                        </button>
                        <button
                          type="button"
                          onClick={() => zoomImage(1.1)}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                        >
                          <IconZoomIn size="w-3.5 h-3.5" className="mr-1" /> 拡大
                        </button>
                        <button
                          type="button"
                          onClick={() => zoomImage(0.9)}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                        >
                          <IconZoomOut size="w-3.5 h-3.5" className="mr-1" /> 縮小
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  「更新する」を押すと画像も公開環境へ反映されます。
                </p>
              </div>

              {/* 更新ボタン */}
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                <IconSave size="w-4 h-4" className="mr-2" /> 更新する
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* カテゴリ管理モーダル */}
      <AttributeModal
        isOpen={showAttributeModal}
        onClose={() => setShowAttributeModal(false)}
        currentAttributes={formData.categories}
        onApply={(categories) => handleInputChange('categories', categories)}
        allAttributes={categories || attributes}
      />
    </div>
  );
}
