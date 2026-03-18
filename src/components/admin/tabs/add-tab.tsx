'use client';

/* eslint-disable @next/next/no-img-element */

import { IconCloudDownload, IconCrop, IconPlusCircle, IconRedo, IconSave, IconSearch, IconTag, IconTags, IconZoomIn, IconZoomOut } from '@/components/icons';
import {
  detectVrcEntryTypeFromUrl,
  ensureWorldCategory,
  extractVRChatAvatarIdFromUrl,
  extractVRChatWorldIdFromUrl,
  shouldResetWorldMetadata,
} from '@/lib/akyo-entry';
import { assertWorldRegistrationAssets } from '@/lib/world-registration';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AttributeModal } from '../attribute-modal';
import { ADD_TAB_DRAFT_KEY } from '../draft-keys';
import type { AdminRole } from '@/types/akyo';

interface AddTabProps {
  userRole: AdminRole;
  // 新フィールド
  categories?: string[];
  authors?: string[];
  // 旧フィールド（互換性）
  attributes: string[];
  creators: string[];
}

interface AddTabDraft {
  nickname: string;
  categories: string[];
  sourceUrl: string;
  boothUrl: string;
  author: string;
  comment: string;
  customCategories: string[];
}

function createDefaultFormData() {
  return {
    nickname: '',
    avatarName: '',
    categories: [] as string[],
    author: '',
    sourceUrl: '',
    boothUrl: '',
    comment: '',
  };
}

function normalizeId(id: string): string | null {
  const parsed = Number.parseInt(id, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed.toString().padStart(4, '0');
}

function pickLatestId(currentId: string, candidateId?: string | null): string {
  const normalizedCurrent = normalizeId(currentId);
  const normalizedCandidate = candidateId ? normalizeId(candidateId) : null;

  if (!normalizedCandidate) {
    return normalizedCurrent ?? currentId;
  }
  if (!normalizedCurrent) {
    return normalizedCandidate;
  }

  const currentNum = Number.parseInt(normalizedCurrent, 10);
  const candidateNum = Number.parseInt(normalizedCandidate, 10);
  return candidateNum >= currentNum ? normalizedCandidate : normalizedCurrent;
}

function getNextSequentialId(id: string): string | null {
  const normalized = normalizeId(id);
  if (!normalized) return null;
  return (Number.parseInt(normalized, 10) + 1).toString().padStart(4, '0');
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
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
 * Add Tab Component
 * 新規登録タブ（完全再現 + VRChat自動取得 + 属性管理）
 */
export function AddTab({ userRole, categories, authors, attributes, creators }: AddTabProps) {
  // 新旧フィールドのマージ
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const allAttributes = Array.from(
    new Set([...(categories || attributes), ...customCategories])
  ).sort();
  // authors/creators は将来の作者フィルター用に保持（現在はVRChatから自動取得）
  void (authors || creators);

  const [nextId, setNextId] = useState('0001');
  const [formData, setFormData] = useState(createDefaultFormData);
  const formRef = useRef<HTMLFormElement | null>(null);
  const nextIdRef = useRef(nextId);
  const draftHydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const savedDraft = sessionStorage.getItem(ADD_TAB_DRAFT_KEY);
      if (!savedDraft) return;

      const parsed = JSON.parse(savedDraft) as Partial<AddTabDraft>;
      setFormData((prev) => ({
        ...prev,
        nickname: typeof parsed.nickname === 'string' ? parsed.nickname : prev.nickname,
        categories: normalizeStringList(parsed.categories),
        sourceUrl:
          typeof parsed.sourceUrl === 'string'
            ? parsed.sourceUrl
            : typeof (parsed as { avatarUrl?: unknown }).avatarUrl === 'string'
            ? ((parsed as { avatarUrl: string }).avatarUrl)
            : prev.sourceUrl,
        boothUrl: typeof parsed.boothUrl === 'string' ? parsed.boothUrl : prev.boothUrl,
        author: typeof parsed.author === 'string' ? parsed.author : prev.author,
        comment: typeof parsed.comment === 'string' ? parsed.comment : prev.comment,
      }));
      setCustomCategories(normalizeStringList(parsed.customCategories));
    } catch (error) {
      console.warn('[add-tab] Failed to restore draft:', error);
    } finally {
      draftHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !draftHydratedRef.current) return;

    const draft: AddTabDraft = {
      nickname: formData.nickname,
      categories: normalizeStringList(formData.categories),
      sourceUrl: formData.sourceUrl,
      boothUrl: formData.boothUrl,
      author: formData.author,
      comment: formData.comment,
      customCategories: normalizeStringList(customCategories),
    };
    sessionStorage.setItem(ADD_TAB_DRAFT_KEY, JSON.stringify(draft));
  }, [
    customCategories,
    formData.sourceUrl,
    formData.boothUrl,
    formData.author,
    formData.categories,
    formData.comment,
    formData.nickname,
  ]);

  const fetchNextId = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/admin/next-id');
      if (response.ok) {
        const data = await response.json();
        if (data?.nextId) {
          const latestId = pickLatestId(nextIdRef.current, data.nextId as string);
          nextIdRef.current = latestId;
          setNextId(latestId);
          return latestId;
        }
      } else {
        console.error('Failed to fetch next ID, using default');
      }
    } catch (error) {
      console.error('Error fetching next ID:', error);
    }
    return null;
  }, []);

  // Fetch next available ID on component mount
  useEffect(() => {
    void fetchNextId();
  }, [fetchNextId]);

  useEffect(() => {
    nextIdRef.current = nextId;
  }, [nextId]);

  const [showAttributeModal, setShowAttributeModal] = useState(false);

  // Image cropping states
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(1);
  const [imageX, setImageX] = useState(0);
  const [imageY, setImageY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Duplicate check states
  const [nicknameStatus, setNicknameStatus] = useState({
    message: '',
    tone: 'neutral' as 'neutral' | 'success' | 'error',
  });
  const [checkingNickname, setCheckingNickname] = useState(false);
  const detectedEntryType = detectVrcEntryTypeFromUrl(formData.sourceUrl);

  // Update image transform when position or scale changes
  useEffect(() => {
    const img = cropImageRef.current;
    if (img) {
      img.style.transform = `translate(${imageX}px, ${imageY}px) scale(${imageScale})`;
    }
  }, [imageX, imageY, imageScale]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const url = formData.sourceUrl.trim();
    if (!url) {
      alert('VRChat URLは必須です');
      return;
    }

    const entryType = detectVrcEntryTypeFromUrl(url);
    if (!entryType) {
      alert(
        '有効なVRChatアバター/ワールドURLを入力してください\n例: https://vrchat.com/home/avatar/avtr_xxx...\nまたは: https://vrchat.com/home/world/wrld_xxx...'
      );
      return;
    }

    const resolvedCategories = normalizeCategoriesForSubmit(formData.categories, entryType);
    if (resolvedCategories.length === 0) {
      alert('カテゴリを1つ以上選択してください');
      return;
    }

    if (nicknameStatus.tone === 'error') {
      if (!confirm('重複する通称が検出されました。\n登録を続行しますか？')) {
        return;
      }
    }

    const formEl = formRef.current;
    if (!formEl) {
      console.error('Form element not found on submit');
      return;
    }

    const submitBtn = formEl.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    const originalText = submitBtn?.innerHTML || '';
    const restoreSubmitButton = () => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '💾 VRChat情報取得中...';
    }

    const nextIdRefreshPromise = fetchNextId();
    let resolvedNickname = formData.nickname.trim();
    let resolvedAvatarName = '';
    let resolvedAuthor = '';
    let imageFile: File | null = null;

    try {
      if (entryType === 'avatar') {
        const avtrId = extractVRChatAvatarIdFromUrl(url);
        if (!avtrId) {
          throw new Error('有効なVRChatアバターURLを入力してください。');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const [infoResponse, imageResponse] = await Promise.all([
            fetch(`/api/vrc-avatar-info?avtr=${avtrId}`, { signal: controller.signal }),
            fetch(`/api/vrc-avatar-image?avtr=${avtrId}&w=1024`, { signal: controller.signal }),
          ]);
          clearTimeout(timeoutId);

          if (!infoResponse.ok) {
            const errorText = await infoResponse.text().catch(() => '');
            throw new Error(
              `アバター情報取得に失敗しました (${infoResponse.status})${
                errorText ? `: ${errorText}` : ''
              }`
            );
          }

          const infoData = (await infoResponse.json()) as {
            avatarName?: string;
            creatorName?: string;
          };
          resolvedAvatarName = infoData.avatarName?.trim() || '';
          resolvedAuthor = infoData.creatorName?.trim() || '';

          if (!resolvedAvatarName) {
            throw new Error('アバター名を取得できませんでした。URLが正しいか確認してください。');
          }
          if (!resolvedAuthor) {
            throw new Error('作者名を取得できませんでした。URLが正しいか確認してください。');
          }

          if (!imageResponse.ok) {
            throw new Error(`画像取得に失敗しました (${imageResponse.status})`);
          }

          const blob = await imageResponse.blob();
          imageFile = new File([blob], `${avtrId}.webp`, { type: 'image/webp' });
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      } else {
        const wrldId = extractVRChatWorldIdFromUrl(url);
        if (!wrldId) {
          throw new Error('有効なVRChatワールドURLを入力してください。');
        }

        const worldController = new AbortController();
        const worldTimeoutId = window.setTimeout(() => worldController.abort(), 30_000);

        let infoResponse: Response;
        try {
          infoResponse = await fetch(`/api/vrc-world-info?wrld=${encodeURIComponent(wrldId)}`, {
            signal: worldController.signal,
          });
        } finally {
          clearTimeout(worldTimeoutId);
        }

        if (!infoResponse.ok) {
          const errorText = await infoResponse.text().catch(() => '');
          throw new Error(
            `ワールド情報取得に失敗しました (${infoResponse.status})${
              errorText ? `: ${errorText}` : ''
            }`
          );
        }

        const infoData = (await infoResponse.json()) as {
          worldName?: string;
          creatorName?: string;
        };
        const fetchedWorldName = infoData.worldName?.trim() || '';
        const fetchedCreatorName = infoData.creatorName?.trim() || '';

        resolvedAuthor = formData.author.trim() || fetchedCreatorName;
        resolvedNickname = formData.nickname.trim() || fetchedWorldName;

        if (
          resolvedNickname !== formData.nickname ||
          resolvedAuthor !== formData.author ||
          resolvedCategories.length !== formData.categories.length
        ) {
          setFormData((prev) => ({
            ...prev,
            nickname: resolvedNickname || prev.nickname,
            author: resolvedAuthor || prev.author,
            categories: resolvedCategories,
          }));
        }

        const imageResponse = await fetch(
          `/api/vrc-world-image?wrld=${encodeURIComponent(wrldId)}&w=1024`
        );
        if (!imageResponse.ok) {
          const errorText = await imageResponse.text().catch(() => '');
          throw new Error(
            `ワールド画像取得に失敗しました (${imageResponse.status})${
              errorText ? `: ${errorText}` : ''
            }`
          );
        }

        const blob = await imageResponse.blob();
        imageFile = new File([blob], `${wrldId}.webp`, {
          type: blob.type || 'image/webp',
        });
        assertWorldRegistrationAssets({
          imageFile,
          resolvedAuthor,
          resolvedNickname,
        });
      }
    } catch (error) {
      console.error('VRChat情報取得エラー:', error);
      restoreSubmitButton();

      alert(
        `❌ 登録に失敗しました\n\n${
          error instanceof Error ? error.message : 'VRChat情報の取得に失敗しました'
        }\n\nURLが正しいか、対象が公開設定か確認してください。`
      );
      return;
    }

    let croppedImageData: string | null = null;
    if (imageFile) {
      if (submitBtn) {
        submitBtn.textContent = '💾 画像処理中...';
      }

      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
          const imgSrc = readerEvent.target?.result as string;
          setOriginalImageSrc(imgSrc);
          setShowImagePreview(true);
          setTimeout(resolve, 100);
        };
        reader.readAsDataURL(imageFile);
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
      croppedImageData = await generateCroppedImage();

      if (!croppedImageData) {
        const reader = new FileReader();
        croppedImageData = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imageFile);
        });
      }
    } else {
      setShowImagePreview(false);
      setOriginalImageSrc(null);
    }

    if (submitBtn) {
      submitBtn.textContent = '💾 登録中...';
    }

    try {
      let submitId = nextIdRef.current;
      const refreshedId = await nextIdRefreshPromise;
      submitId = pickLatestId(submitId, refreshedId);

      const displayName = entryType === 'world' ? resolvedNickname : resolvedAvatarName;

      const buildSubmitData = (id: string) => {
        const submitData = new FormData();
        submitData.append('id', id);
        submitData.append('entryType', entryType);
        submitData.append('nickname', resolvedNickname);
        submitData.append('avatarName', entryType === 'world' ? '' : resolvedAvatarName);
        submitData.append('sourceUrl', url);
        submitData.append('avatarUrl', url);
        if (formData.boothUrl.trim()) {
          submitData.append('boothUrl', formData.boothUrl.trim());
        }
        submitData.append('author', resolvedAuthor);
        submitData.append('category', resolvedCategories.join(','));
        submitData.append('comment', formData.comment);
        submitData.append('creator', resolvedAuthor);
        submitData.append('attributes', resolvedCategories.join(','));
        submitData.append('notes', formData.comment);

        if (croppedImageData) {
          submitData.append('imageData', croppedImageData);
        }

        return submitData;
      };

      const uploadWithId = async (id: string) => {
        const response = await fetch('/api/upload-akyo', {
          method: 'POST',
          body: buildSubmitData(id),
        });
        const result = await response.json();
        return { response, result };
      };

      let { response, result } = await uploadWithId(submitId);
      if (!result) result = { success: false, error: 'アップロード結果を取得できませんでした' };

      let latestKnownId: string | null = null;

      if ((!response.ok || !result.success) && response.status === 409) {
        const latestId = await fetchNextId();
        if (latestId) {
          latestKnownId = pickLatestId(submitId, latestId);
        }

        const retryId = latestKnownId ?? getNextSequentialId(submitId);
        if (retryId && retryId !== submitId) {
          submitId = retryId;
          const retryResult = await uploadWithId(submitId);
          response = retryResult.response;
          result = retryResult.result || {
            success: false,
            error: 'リトライ結果を取得できませんでした',
          };
        }
      }

      if (!response.ok || !result.success) {
        if (response.status === 409) {
          const latestId = pickLatestId(
            submitId,
            latestKnownId ?? (await fetchNextId()) ?? getNextSequentialId(submitId)
          );
          const latestHint =
            userRole === 'owner'
              ? latestId
                ? `\n\n最新の利用可能ID: #${latestId}\n再度登録してください。`
                : '\n\nIDの再取得に失敗しました。画面を再読み込みして再試行してください。'
              : '\n\nしばらく待ってから再度登録してください。';
          throw new Error((result.error || 'IDが重複しています') + latestHint);
        }
        throw new Error(result.error || 'サーバーエラーが発生しました');
      }

      alert(
        `✅ ${result.message}\n\n` +
          `ID: #${submitId}\n` +
          `${entryType === 'world' ? '名称' : 'アバター名'}: ${displayName}\n` +
          `作者: ${resolvedAuthor}\n\n` +
          (result.commitUrl ? `コミット: ${result.commitUrl}` : '')
      );

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(ADD_TAB_DRAFT_KEY);
      }
      setFormData(createDefaultFormData());
      setShowImagePreview(false);
      setOriginalImageSrc(null);
      setNicknameStatus({ message: '', tone: 'neutral' });

      const currentId = parseInt(submitId, 10);
      if (!isNaN(currentId)) {
        const nextSequentialId = (currentId + 1).toString().padStart(4, '0');
        setNextId((prev) => pickLatestId(prev, nextSequentialId));
      }
    } catch (error) {
      console.error('Form submission error:', error);
      alert(
        '❌ 登録に失敗しました\n\n' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました') +
          '\n\nもう一度お試しください。'
      );
    } finally {
      restoreSubmitButton();
    }
  };

  const handleInputChange = (field: string, value: string | string[]) => {
    if (field === 'sourceUrl' && typeof value === 'string') {
      setFormData((prev) => ({
        ...prev,
        sourceUrl: value,
        ...(shouldResetWorldMetadata(prev.sourceUrl, value) ? { nickname: '', author: '' } : {}),
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateCategory = (categoryName: string) => {
    const normalizedInput = categoryName.trim().normalize('NFC').toLowerCase();
    if (!normalizedInput) return;

    setCustomCategories((prev) => {
      const exists = prev.some(
        (existing) => existing.normalize('NFC').toLowerCase() === normalizedInput
      );
      if (exists) return prev;
      return [...prev, categoryName.trim()];
    });
  };

  // Nickname duplicate check function
  const handleCheckNicknameDuplicate = async () => {
    const trimmedValue = formData.nickname.trim();

    if (!trimmedValue) {
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
          value: trimmedValue,
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
      console.error('通称 duplicate check error:', error);
      setNicknameStatus({
        message: '重複チェックに失敗しました',
        tone: 'error',
      });
    } finally {
      setCheckingNickname(false);
    }
  };

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

  const zoomImage = (factor: number) => {
    setImageScale((prev) => {
      const newScale = prev * factor;
      return Math.max(0.5, Math.min(3, newScale));
    });
  };

  // Note: handleImageFile, handleFileInputChange, handleDrop, handleDragOver
  // were removed - images are now automatically fetched from VRChat URL

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

        const baseScale = imageAspect > containerAspect ? ch / ih : cw / iw;
        const totalScale = baseScale * imageScale;

        const sx = Math.max(0, -imageX / totalScale);
        const sy = Math.max(0, -imageY / totalScale);
        const sw = Math.min(iw - sx, cw / totalScale);
        const sh = Math.min(ih - sy, ch / totalScale);

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvasW, canvasH);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            } else {
              resolve(null);
            }
          },
          'image/webp',
          0.9
        );
      };
      image.crossOrigin = 'anonymous';
      image.src = originalImageSrc;
    });
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-6">
        <IconPlusCircle size="w-5 h-5" className="text-red-500 mr-2" /> 新しいAkyoアバター/ワールドを登録
      </h2>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ID（自動採番） */}
          <div>
            <label htmlFor="add-tab-id" className="block text-gray-700 text-sm font-medium mb-1">
              ID（自動採番）
            </label>
            {userRole === 'owner' ? (
              <input
                id="add-tab-id"
                type="text"
                value={nextId}
                disabled
                className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg font-mono font-bold"
              />
            ) : (
              <input
                id="add-tab-id"
                type="text"
                value="登録時に自動割り当て"
                disabled
                className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
              />
            )}
            <p className="mt-2 text-xs text-gray-500 leading-snug">
              {userRole === 'owner'
                ? '画像IDの自動割り当てはローカルに保存された画像を優先的に参照し、未使用の番号（CSV未登録の画像も含む）から決定されます。'
                : 'IDは登録時に自動で割り当てられます。'}
            </p>
          </div>

          {/* 通称 */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="add-tab-nickname" className="block text-gray-700 text-sm font-medium">
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
                    <svg
                      className="w-3 h-3 animate-spin"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
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
              id="add-tab-nickname"
              type="text"
              value={formData.nickname}
              onChange={(e) => {
                handleInputChange('nickname', e.target.value);
                // Clear status when user changes input
                setNicknameStatus({ message: '', tone: 'neutral' });
              }}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
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

          {/* 名称 */}
          <div>
            <label htmlFor="add-tab-name" className="block text-gray-700 text-sm font-medium mb-1">
              名称
            </label>
            <input
              id="add-tab-name"
              type="text"
              value={
                detectedEntryType === 'world'
                  ? 'ワールド名は上の「通称」欄を名称として使用します'
                  : '登録時にVRChat URLから自動取得'
              }
              disabled
              className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
            />
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
                  <p className="text-sm text-gray-500">選択されたカテゴリがここに表示されます</p>
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
            <label htmlFor="add-tab-author" className="block text-gray-700 text-sm font-medium mb-1">
              作者（自動取得 / 必要時は手動入力）
            </label>
            {detectedEntryType === 'world' ? (
              <input
                id="add-tab-author"
                type="text"
                value={formData.author}
                onChange={(e) => handleInputChange('author', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="取得失敗時はここで補完できます"
              />
            ) : (
              <input
                id="add-tab-author"
                type="text"
                value="登録時にVRChat URLから自動取得"
                disabled
                className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
              />
            )}
          </div>

          {/* VRChat URL */}
          <div>
            <label htmlFor="add-tab-source-url" className="block text-gray-700 text-sm font-medium mb-1">
              VRChat URL（アバターまたはワールド） <span className="text-red-500">*</span>
            </label>
            <input
              id="add-tab-source-url"
              type="url"
              value={formData.sourceUrl}
              onChange={(e) => handleInputChange('sourceUrl', e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="https://vrchat.com/home/avatar/avtr_... または https://vrchat.com/home/world/wrld_..."
            />
            {detectedEntryType && (
              <p className="mt-2 text-xs font-medium text-blue-600">
                検出: {detectedEntryType === 'world' ? 'ワールド' : 'アバター'}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500 leading-snug">
              {detectedEntryType === 'world'
                ? 'ワールドURLとして検出しました。登録時に名称・作者・画像を取得し、足りない項目だけ手動で補完できます。'
                : '登録ボタンを押すと、このURLから名称・作者名・画像が自動的に取得されます。'}
            </p>
          </div>
        </div>

        {/* BOOTH URL */}
        <div>
          <label htmlFor="add-tab-booth-url" className="block text-gray-700 text-sm font-medium mb-1">
            BOOTH URL（任意）
          </label>
          <input
            id="add-tab-booth-url"
            type="url"
            value={formData.boothUrl}
            onChange={(e) => handleInputChange('boothUrl', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="https://booth.pm/ja/items/..."
          />
          <p className="mt-2 text-xs text-gray-500 leading-snug">
            BOOTHの販売ページURLを入力すると、図鑑のカード・リスト表示にBOOTHリンクボタンが表示されます。
          </p>
        </div>

        {/* おまけ情報（comment） */}
        <div>
          <label htmlFor="add-tab-comment" className="block text-gray-700 text-sm font-medium mb-1">
            おまけ情報
          </label>
          <textarea
            id="add-tab-comment"
            value={formData.comment}
            onChange={(e) => handleInputChange('comment', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Quest対応、特殊機能など"
          />
        </div>

        {/* 画像（自動取得） */}
        <div>
          <label className="block text-gray-700 text-sm font-medium mb-1">
            画像（登録時に自動取得）
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
            <IconCloudDownload size="w-10 h-10" className="text-blue-400 mb-2 mx-auto" />
            <p className="text-gray-600 font-medium">VRChat URLから自動取得</p>
            <p className="text-sm text-gray-500 mt-1">
              {detectedEntryType === 'world'
                ? 'ワールドURLでもサムネイル取得を試み、失敗時は画像なしで登録できます'
                : '登録ボタンを押すと、URL種別に応じてVRChatから画像を自動的に取得します'}
            </p>
          </div>

          {/* Image Cropping Preview (自動取得後に表示) */}
          {showImagePreview && (
            <div className="mt-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  <IconCrop size="w-4 h-4" className="mr-2" />画像のトリミング調整
                </h3>

                {/* Crop Container */}
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

                {/* Control Buttons */}
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
            登録すると画像も公開環境へ自動でアップロードされ、図鑑でもすぐ表示されます。
          </p>
        </div>

        {/* 登録ボタン */}
        <button
          type="submit"
          className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          <IconSave size="w-4 h-4" className="mr-2" /> 登録する
        </button>
      </form>

      {/* 属性管理モーダル */}
      <AttributeModal
        isOpen={showAttributeModal}
        onClose={() => setShowAttributeModal(false)}
        currentAttributes={formData.categories}
        onApply={(attributes) => handleInputChange('categories', attributes)}
        allAttributes={allAttributes}
        onCreateAttribute={handleCreateCategory}
        listColumns={4}
        modalSize="wide"
      />
    </div>
  );
}
