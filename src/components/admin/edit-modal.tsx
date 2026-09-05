'use client';

/* eslint-disable @next/next/no-img-element */

import {
  IconClose,
  IconCloudDownload,
  IconEdit,
  IconExternalLink,
  IconSave,
  IconTag,
  IconTags,
  IconUser,
} from '@/components/icons';
import {
  detectVrcEntryTypeFromUrl,
  ensureWorldCategory,
  extractVRChatAvatarIdFromUrl,
  getAkyoSourceUrl,
  resolveDisplaySerialForSourceUrlChange,
  shouldResetWorldMetadata,
} from '@/lib/akyo-entry';
import { EDIT_FIELD_NAMES, type AkyoEditFields } from '@/lib/akyo-edit-fields';
import { buildAvatarImageUrl } from '@/lib/vrchat-utils';
import type { AkyoData, AkyoEntryType } from '@/types/akyo';
import { FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { AttributeModal } from './attribute-modal';
import { DuplicateCheckButton } from './duplicate-check-button';
import { Spinner } from './spinner';
import { useModalDialog } from '@/hooks/use-modal-dialog';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  akyo: AkyoData | null;
  // 新フィールド
  categories?: string[];
  // 旧フィールド（互換性）
  attributes: string[];

  onStage: (fields: AkyoEditFields) => void;
}

interface EditFormData {
  entryType: AkyoEntryType;
  displaySerial: string;
  nickname: string;
  avatarName: string;
  // UI上は複数選択UIを維持するため配列で扱う
  categories: string[];
  author: string;
  sourceUrl: string;
  avatarUrl: string;
  boothUrl: string;
  comment: string;
}

interface FieldStatusState {
  message: string;
  tone: 'neutral' | 'success' | 'error';
}

const EMPTY_STATUS: FieldStatusState = { message: '', tone: 'neutral' };

const ENTRY_TYPE_LABEL: Record<AkyoEntryType, string> = {
  avatar: 'アバター',
  world: 'ワールド',
  booth: 'BOOTH専用',
};

const NICKNAME_LABEL: Record<AkyoEntryType, string> = {
  avatar: 'ニックネーム',
  world: 'ワールド名',
  booth: '名前',
};

const INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500';
const LABEL_CLASS = 'block text-gray-700 text-sm font-medium';
const HELP_CLASS = 'mt-2 text-xs text-gray-500 leading-snug';
const LEGEND_CLASS = 'flex items-center gap-2 text-sm font-bold text-gray-800 mb-3';

function normalizeCategoriesForSubmit(
  categories: string[],
  entryType: AkyoEntryType
): string[] {
  const normalized = categories
    .map((category) => category.trim())
    .filter(Boolean);

  return entryType === 'world'
    ? ensureWorldCategory(normalized)
    : Array.from(new Set(normalized));
}

function buildInitialFormData(akyo: AkyoData | null): EditFormData {
  if (!akyo) {
    return {
      entryType: 'avatar',
      displaySerial: '',
      nickname: '',
      avatarName: '',
      categories: [],
      author: '',
      sourceUrl: '',
      avatarUrl: '',
      boothUrl: '',
      comment: '',
    };
  }

  // 新旧フィールド対応
  const categoryStr = akyo.category || akyo.attribute || '';
  const authorStr = akyo.author || akyo.creator || '';
  const commentStr = akyo.comment || akyo.notes || '';
  const sourceUrl = getAkyoSourceUrl(akyo);
  const resolvedEntryType =
    akyo.entryType || detectVrcEntryTypeFromUrl(sourceUrl) || 'avatar';

  return {
    entryType: resolvedEntryType,
    displaySerial: akyo.displaySerial || (resolvedEntryType === 'world' ? '' : akyo.id),
    nickname: akyo.nickname || '',
    avatarName: akyo.avatarName || '',
    categories: normalizeCategoriesForSubmit(
      categoryStr ? categoryStr.split(/[、,]/).map((a) => a.trim()) : [],
      resolvedEntryType
    ),
    author: authorStr,
    sourceUrl,
    avatarUrl: akyo.avatarUrl || sourceUrl,
    boothUrl: akyo.boothUrl || '',
    comment: commentStr,
  };
}

/**
 * 重複確認の結果表示。常に DOM に置いておき、文言が入ったときだけ見せる。
 * aria-live 領域は更新前から存在している必要があるため、空でも消さない。
 */
function FieldStatus({ id, status }: { id: string; status: FieldStatusState }) {
  const toneClass =
    status.tone === 'error'
      ? 'text-red-600'
      : status.tone === 'success'
      ? 'text-green-600'
      : 'text-gray-600';

  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className={status.message ? `mt-2 text-sm ${toneClass}` : 'sr-only'}
    >
      {status.message}
    </p>
  );
}

/**
 * Edit Modal Component
 * Akyoデータの編集モーダル。
 *
 * レイアウトは登録画面（add-tab.tsx）を基準に揃えている。
 * 親（EditTab）が akyo.id を key に渡して開くたびに作り直すので、
 * 初期値は useState の初期化子で一度だけ組み立てればよい。
 *
 * 画像の差し替えはこの画面では扱わない。サムネイルは登録時に VRChat から
 * 取得したものを使い、差し替えは最適化フローが落ち着いてから別途対応する。
 */
export function EditModal({
  isOpen,
  onClose,
  akyo,
  categories,
  attributes,
  onStage,
}: EditModalProps) {
  const [formData, setFormData] = useState<EditFormData>(() => buildInitialFormData(akyo));
  const initialFormJson = useMemo(() => JSON.stringify(buildInitialFormData(akyo)), [akyo]);

  const [showAttributeModal, setShowAttributeModal] = useState(false);
  // このモーダル内で新規作成したカテゴリ。登録画面（add-tab.tsx）と同じく、
  // 既存候補にマージして「カテゴリを管理」を開き直しても候補に残るようにする
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [fetchingName, setFetchingName] = useState(false);

  // Duplicate check states
  const [nicknameStatus, setNicknameStatus] = useState<FieldStatusState>(EMPTY_STATUS);
  const [avatarNameStatus, setAvatarNameStatus] = useState<FieldStatusState>(EMPTY_STATUS);
  const [checkingNickname, setCheckingNickname] = useState(false);
  const [checkingAvatarName, setCheckingAvatarName] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const isWorldEntry = formData.entryType === 'world';
  const isBoothEntry = formData.entryType === 'booth';
  const isAvatarEntry = !isWorldEntry && !isBoothEntry;
  const detectedEntryType = detectVrcEntryTypeFromUrl(formData.sourceUrl.trim());

  const isDirty = JSON.stringify(formData) !== initialFormJson;

  const currentImageUrl = useMemo(
    () => (akyo ? buildAvatarImageUrl(akyo.id, getAkyoSourceUrl(akyo), 512) : null),
    [akyo]
  );

  const allCategories = useMemo(
    () => Array.from(new Set([...(categories || attributes), ...customCategories])).sort(),
    [categories, attributes, customCategories]
  );

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

  // 未保存の変更があるときは閉じる前に確認する（Escape / 背景クリック / ×ボタン / キャンセル共通）
  const requestClose = useCallback(() => {
    if (isDirty && !confirm('保存していない変更があります。\nこのまま閉じますか？')) {
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  useModalDialog({
    isOpen: isOpen && akyo !== null,
    onRequestClose: requestClose,
    dialogRef,
    initialFocusRef: closeButtonRef,
    suspended: showAttributeModal,
  });

  const handleInputChange = (field: keyof EditFormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSourceUrlChange = (value: string) => {
    const nextDetectedEntryType = detectVrcEntryTypeFromUrl(value.trim());
    setFormData((prev) => {
      // sourceUrlが空になった場合、boothUrlがあればboothに戻す
      const resolvedEntryType =
        nextDetectedEntryType ??
        (!value.trim() && prev.boothUrl.trim() ? 'booth' : prev.entryType);
      return {
        ...prev,
        sourceUrl: value,
        avatarUrl: value,
        entryType: resolvedEntryType,
        ...(shouldResetWorldMetadata(prev.sourceUrl, value)
          ? { nickname: '', author: '' }
          : {}),
        displaySerial: resolveDisplaySerialForSourceUrlChange({
          currentDisplaySerial: prev.displaySerial,
          detectedEntryType: nextDetectedEntryType,
          id: akyo?.id ?? prev.displaySerial,
          originalDisplaySerial: akyo?.displaySerial,
          originalEntryType: akyo?.entryType,
        }),
      };
    });
  };

  // Duplicate check for nickname
  const handleCheckNicknameDuplicate = async () => {
    const value = formData.nickname.trim();

    if (!value) {
      setNicknameStatus({ message: '名前を入力してください', tone: 'neutral' });
      return;
    }

    setCheckingNickname(true);
    setNicknameStatus(EMPTY_STATUS);

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
      setNicknameStatus({ message: '重複チェックに失敗しました', tone: 'error' });
    } finally {
      setCheckingNickname(false);
    }
  };

  // Duplicate check for avatar name
  const handleCheckAvatarNameDuplicate = async () => {
    const value = formData.avatarName.trim();

    if (!value) {
      setAvatarNameStatus({ message: 'アバター名を入力してください', tone: 'neutral' });
      return;
    }

    setCheckingAvatarName(true);
    setAvatarNameStatus(EMPTY_STATUS);

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
      setAvatarNameStatus({ message: '重複チェックに失敗しました', tone: 'error' });
    } finally {
      setCheckingAvatarName(false);
    }
  };

  // VRChat URLからアバター名を取得
  const handleFetchAvatarName = async () => {
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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!akyo) return;

    // Validate required fields
    if (isAvatarEntry && !formData.avatarName.trim()) {
      alert('アバター名は必須です');
      return;
    }
    if (isWorldEntry && !formData.nickname.trim()) {
      alert('ワールド名（名前）は必須です');
      return;
    }
    if (isBoothEntry && !formData.nickname.trim()) {
      alert('名前は必須です');
      return;
    }
    if (!formData.sourceUrl.trim() && !formData.boothUrl.trim()) {
      alert('VRChat URLまたはBOOTH URLのいずれかを入力してください');
      return;
    }
    if (!formData.author.trim()) {
      alert('作者は必須です');
      return;
    }
    if (!isBoothEntry && formData.categories.length === 0) {
      alert('カテゴリを1つ以上選択してください');
      return;
    }

    // Check for duplicates (excluding current akyo)
    if (nicknameStatus.tone === 'error' || avatarNameStatus.tone === 'error') {
      if (!confirm('重複する名前またはアバター名が検出されました。\n更新を続行しますか？')) {
        return;
      }
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
      submitData.append('avatarName', isAvatarEntry ? formData.avatarName : '');
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

      const staged = Object.fromEntries(
        EDIT_FIELD_NAMES.map((key) => [key, String(submitData.get(key) ?? '').trim()])
      ) as AkyoEditFields;
      onStage(staged);
      onClose();
    } catch (error) {
      console.error('Form submission error:', error);
      alert(
        '❌ 保留に失敗しました\n\n' +
          (error instanceof Error ? error.message : '不明なエラーが発生しました') +
          '\n\nもう一度お試しください。'
      );
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      requestClose();
    }
  };

  if (!isOpen || !akyo) return null;

  const formId = 'edit-akyo-form';
  const nicknameLabel = NICKNAME_LABEL[formData.entryType];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={handleBackdropClick}>
      <div className="modal-backdrop fixed inset-0" aria-hidden="true" />

      <div
        className="relative flex min-h-full items-start justify-center p-4 sm:items-center sm:p-8"
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
          aria-describedby="edit-modal-meta"
          tabIndex={-1}
          className="modal-show relative flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)] focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ヘッダー: 何を編集しているか（ID・種別）を常に見せる。ID は入力欄ではなく情報。
              <header> 要素は globals.css のサイトヘッダー用グラデーションを !important で
              受けてしまうので、ここは div にしている */}
          <div className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-gray-200 bg-gradient-to-r from-red-50 to-orange-50 px-6 py-4">
            <div className="min-w-0">
              <h2 id="edit-modal-title" className="flex items-center gap-2 text-xl font-bold text-gray-800">
                <IconEdit size="w-5 h-5" className="text-red-500" />
                Akyoを編集
              </h2>
              <p id="edit-modal-meta" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span className="font-mono font-bold text-gray-800">#{akyo.id}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                  {ENTRY_TYPE_LABEL[formData.entryType]}
                </span>
                {isWorldEntry && formData.displaySerial && (
                  <span className="text-xs">表示番号: World{formData.displaySerial}</span>
                )}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={requestClose}
              aria-label="閉じる"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white hover:text-gray-800"
            >
              <IconClose size="w-5 h-5" />
            </button>
          </div>

          {/* 本文: ここだけスクロールする。フッターの操作は常に見える */}
          <form
            id={formId}
            onSubmit={handleSubmit}
            className="flex-1 space-y-6 overflow-y-auto px-6 py-5"
          >
            {/* ── 基本情報 ── */}
            <fieldset className="space-y-4">
              <legend className={LEGEND_CLASS}>
                <IconUser size="w-4 h-4" className="text-red-500" />
                基本情報
              </legend>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="edit-nickname" className={LABEL_CLASS}>
                    {nicknameLabel}
                  </label>
                  <DuplicateCheckButton
                    checking={checkingNickname}
                    onClick={handleCheckNicknameDuplicate}
                    fieldLabel={nicknameLabel}
                  />
                </div>
                <input
                  id="edit-nickname"
                  type="text"
                  value={formData.nickname}
                  onChange={(e) => {
                    handleInputChange('nickname', e.target.value);
                    setNicknameStatus(EMPTY_STATUS);
                  }}
                  aria-describedby="edit-nickname-status"
                  className={`mt-2 ${INPUT_CLASS}`}
                  placeholder="例: チョコミントAkyo"
                />
                <FieldStatus id="edit-nickname-status" status={nicknameStatus} />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {isAvatarEntry && (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="edit-avatar-name" className={LABEL_CLASS}>
                        アバター名
                      </label>
                      <DuplicateCheckButton
                        checking={checkingAvatarName}
                        onClick={handleCheckAvatarNameDuplicate}
                        fieldLabel="アバター名"
                      />
                    </div>
                    <input
                      id="edit-avatar-name"
                      type="text"
                      value={formData.avatarName}
                      onChange={(e) => {
                        handleInputChange('avatarName', e.target.value);
                        setAvatarNameStatus(EMPTY_STATUS);
                      }}
                      required
                      aria-describedby="edit-avatar-name-status"
                      className={`mt-2 ${INPUT_CLASS}`}
                      placeholder="例: Akyo origin"
                    />
                    <FieldStatus id="edit-avatar-name-status" status={avatarNameStatus} />
                  </div>
                )}

                <div className={isAvatarEntry ? '' : 'md:col-span-2'}>
                  <label htmlFor="edit-author" className={LABEL_CLASS}>
                    作者
                  </label>
                  <input
                    id="edit-author"
                    type="text"
                    value={formData.author}
                    onChange={(e) => handleInputChange('author', e.target.value)}
                    required
                    className={`mt-2 ${INPUT_CLASS}`}
                    placeholder="例: ugai"
                  />
                </div>
              </div>
            </fieldset>

            {/* ── カテゴリ ── */}
            <fieldset>
              <legend className={LEGEND_CLASS}>
                <IconTags size="w-4 h-4" className="text-green-600" />
                カテゴリ
              </legend>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAttributeModal(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-300 bg-green-100 px-3 py-2 text-green-800 transition-colors hover:bg-green-200"
                >
                  <IconTags size="w-4 h-4" />
                  カテゴリを管理
                </button>
                <div className="min-h-[60px] rounded-lg border border-dashed border-green-200 bg-white/60 p-3">
                  {formData.categories.length === 0 ? (
                    <p className="text-sm text-gray-500">選択されたカテゴリがここに表示されます</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {formData.categories.map((cat) => (
                        <li
                          key={cat}
                          className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-sm text-green-800"
                        >
                          <IconTag size="w-3 h-3" />
                          {cat}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs leading-snug text-gray-500">
                  ワールドならワールドカテゴリは自動追加されますが、階層型カテゴリを設定する場合は手動で設定してください。
                </p>
              </div>
            </fieldset>

            {/* ── リンク ── */}
            <fieldset>
              <legend className={LEGEND_CLASS}>
                <IconExternalLink size="w-4 h-4" className="text-blue-600" />
                リンク
              </legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="edit-source-url" className={LABEL_CLASS}>
                    VRChat URL（アバターまたはワールド）
                  </label>
                  <input
                    id="edit-source-url"
                    type="url"
                    value={formData.sourceUrl}
                    onChange={(e) => handleSourceUrlChange(e.target.value)}
                    aria-describedby="edit-source-url-help"
                    className={`mt-2 ${INPUT_CLASS}`}
                    placeholder="https://vrchat.com/home/avatar/avtr_... または https://vrchat.com/home/world/wrld_..."
                  />
                  {detectedEntryType && (
                    <p className="mt-2 text-xs font-medium text-blue-600">
                      検出: {detectedEntryType === 'world' ? 'ワールド' : 'アバター'}
                    </p>
                  )}
                  {isAvatarEntry ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={handleFetchAvatarName}
                        disabled={fetchingName}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {fetchingName ? <Spinner /> : <IconEdit size="w-4 h-4" />}
                        {fetchingName ? '取得中...' : 'URLからアバター名を取得'}
                      </button>
                    </div>
                  ) : null}
                  <p id="edit-source-url-help" className={HELP_CLASS}>
                    {isWorldEntry
                      ? 'ワールドの名称・画像は登録時に取得済みです。'
                      : isBoothEntry
                      ? 'BOOTH専用エントリです。VRChat URLを入力すると種別が自動で切り替わります。'
                      : 'URLを変えた場合は、上のボタンでアバター名を取り直せます。'}
                  </p>
                </div>

                <div>
                  <label htmlFor="edit-booth-url" className={LABEL_CLASS}>
                    BOOTH URL（任意）
                  </label>
                  <input
                    id="edit-booth-url"
                    type="url"
                    value={formData.boothUrl}
                    onChange={(e) => handleInputChange('boothUrl', e.target.value)}
                    aria-describedby="edit-booth-url-help"
                    className={`mt-2 ${INPUT_CLASS}`}
                    placeholder="https://booth.pm/ja/items/..."
                  />
                  <p id="edit-booth-url-help" className={HELP_CLASS}>
                    BOOTHの販売ページURLを入力すると、図鑑にBOOTHリンクボタンが表示されます。
                  </p>
                </div>
              </div>
            </fieldset>

            {/* ── あきょうちしき ── */}
            <div>
              <label htmlFor="edit-comment" className={LABEL_CLASS}>
                あきょうちしき
              </label>
              <textarea
                id="edit-comment"
                value={formData.comment}
                onChange={(e) => handleInputChange('comment', e.target.value)}
                rows={3}
                className={`mt-2 ${INPUT_CLASS}`}
                placeholder="Quest対応、特殊機能など"
              />
            </div>

            {/* ── 画像（表示のみ） ── */}
            <fieldset>
              <legend className={LEGEND_CLASS}>
                <IconCloudDownload size="w-4 h-4" className="text-blue-500" />
                画像
              </legend>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <img
                  src={currentImageUrl ?? '/images/placeholder.webp'}
                  alt={`${formData.nickname || formData.avatarName || akyo.id} の現在の画像`}
                  width={240}
                  height={160}
                  className="aspect-[3/2] w-full rounded-lg border border-gray-200 bg-gray-50 object-cover sm:w-60 sm:shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = '/images/placeholder.webp';
                  }}
                />
                <p className="min-w-0 text-xs leading-snug text-gray-500 sm:pt-1">
                  サムネイルは登録時に VRChat から取得したものを使っています。この画面からの差し替えは、画像最適化フローが整ってから対応予定です。
                </p>
              </div>
            </fieldset>
          </form>

          {/* フッター: 操作は常に見える位置に固定。form 属性で本文のフォームと結びつける */}
          <div className="flex flex-col-reverse gap-3 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">{isDirty ? '未反映の変更あり' : ''}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                type="submit"
                form={formId}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500 px-5 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <IconSave size="w-4 h-4" />
                更新を保留
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* カテゴリ管理モーダル — 登録画面（add-tab.tsx）と同じ大きさ・列数・作成挙動 */}
      <AttributeModal
        isOpen={showAttributeModal}
        onClose={() => setShowAttributeModal(false)}
        currentAttributes={formData.categories}
        onApply={(nextCategories) => handleInputChange('categories', nextCategories)}
        allAttributes={allCategories}
        onCreateAttribute={handleCreateCategory}
        listColumns={4}
        modalSize="wide"
      />
    </div>
  );
}
