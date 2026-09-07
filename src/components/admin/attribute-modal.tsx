'use client';

import { IconCheckCircle, IconCircle, IconClose, IconPlusCircle, IconSearch, IconTags } from '@/components/icons';
import { isComposingKeyboardEvent, useModalDialog } from '@/hooks/use-modal-dialog';
import { findCreateBlocker, planCategoryCreateLevels } from '@/lib/category-create-levels';
import { selectCategoryPath, toggleCategoryPath } from '@/lib/category-operations';
import { useState, useEffect, useRef } from 'react';

interface AttributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAttributes: string[];
  onApply: (attributes: string[]) => void;
  allAttributes: string[];
  onCreateAttribute?: (attribute: string) => void;
  /** 作成がコミットされたとき。共有の一覧を取り直さないと他のタブが古いままになる */
  onCategoriesChanged?: () => void;
  listColumns?: 3 | 4;
  modalSize?: 'default' | 'wide';
}

/**
 * Attribute Management Modal
 * カテゴリ（旧: 属性）管理モーダル（完全再現）
 */
export function AttributeModal({
  isOpen,
  onClose,
  currentAttributes,
  onApply,
  allAttributes,
  onCreateAttribute,
  onCategoriesChanged,
  listColumns = 3,
  modalSize = 'default',
}: AttributeModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAttributeName, setNewAttributeName] = useState('');
  // 階層ごとの対訳。キーは完全なパスなので、名前を打ち直しても既に入れた分は残る
  const [levelNames, setLevelNames] = useState<Record<string, { en: string; ko: string }>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [availableAttributes, setAvailableAttributes] = useState<string[]>(allAttributes);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 親（EditModal）は showAttributeModal 中に suspended=true で自分のトラップを止めるので、
  // ここで張るトラップと競合しない。復帰先は未指定 = 開いた時点の activeElement
  // （「カテゴリを管理」ボタン）。AddTab から開いた場合も同じ経路で戻る
  useModalDialog({
    isOpen,
    onRequestClose: onClose,
    dialogRef,
    initialFocusRef: searchInputRef,
  });

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedAttributes([...currentAttributes]);
    }
  }, [isOpen, currentAttributes]);

  useEffect(() => {
    // Merge existing allAttributes with any newly created ones in availableAttributes
    // This prevents data loss when props update
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailableAttributes(prev => {
      const merged = new Set([...allAttributes, ...prev]);
      return Array.from(merged).sort();
    });
  }, [allAttributes]);

  const filteredAttributes = availableAttributes.filter((attr) =>
    attr.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 子を選べば親も付き、親を外せば配下も外れる。1 段ずつ押させると親を付け忘れた行が
  // 作れてしまい、Akyo の行が「持つトークンの祖先を全部並べる」形から外れる
  const handleToggleAttribute = (attr: string) => {
    setSelectedAttributes((prev) => toggleCategoryPath(prev, attr));
  };

  const resetCreateForm = () => {
    setNewAttributeName('');
    setLevelNames({});
    setCreateError('');
  };

  // 入力されたパスを階層に分け、まだ無い階層だけ対訳を訊く
  const createLevels = planCategoryCreateLevels(newAttributeName, availableAttributes);
  const missingLevels = createLevels.filter((level) => !level.exists);
  // 末尾の階層は planCategoryCreateLevels が返したパスで持つ。入力文字列から別に
  // 組み立てると、階層の前後に空白がある入力で入力欄とキーがずれ、画面が見せた
  // 階層と送るパスも食い違う。パスとして成り立たない入力のときだけ原文を送り、
  // サーバーに理由を言わせる
  const leafPath = createLevels.at(-1)?.path ?? '';
  // カテゴリ名は利用者が決めるので `constructor` のようなプロトタイプの名前もあり得る。
  // 素引きすると Object.prototype 側の値を拾ってしまう
  const nameOf = (path: string) =>
    Object.hasOwn(levelNames, path) ? levelNames[path] : { en: '', ko: '' };
  const setNameOf = (path: string, patch: Partial<{ en: string; ko: string }>) => {
    setLevelNames((previous) => ({
      ...previous,
      [path]: {
        ...(Object.hasOwn(previous, path) ? previous[path] : { en: '', ko: '' }),
        ...patch,
      },
    }));
  };

  // カテゴリはその場で GitHub にコミットする。対訳（EN/KO）は任意で、空のままなら
  // その階層は EN/KO のデータでも日本語のまま出る（生成側が段ごとに落とす）。
  const handleCreateAttribute = async () => {
    if (creating) return;
    const trimmed = newAttributeName.trim();
    if (!trimmed) {
      setCreateError('カテゴリ名を入力してください');
      return;
    }

    // 既にある名前と、表記だけが違って見分けの付かない名前を止める。サーバーも
    // 同じ規則で拒否するので、ここは送る前に気付かせるためのもの
    const blocker = findCreateBlocker(createLevels);
    if (blocker) {
      setCreateError(blocker);
      return;
    }

    setCreating(true);
    setCreateError('');
    // 作られるのは足りない階層と末尾。応答が createdPaths を返さなくても、
    // 送った内容から同じものを組み立てられるようにしておく
    const submittedPath = leafPath || trimmed;
    const requested = [...missingLevels.map((level) => level.path)];
    if (!requested.includes(submittedPath)) requested.push(submittedPath);
    let created: string[] = requested;
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          path: submittedPath,
          en: nameOf(leafPath).en.trim(),
          ko: nameOf(leafPath).ko.trim(),
          // 末尾以外で足りない階層は、まとめて作ってもらう
          ancestors: missingLevels
            .filter((level) => level.path !== leafPath)
            .map((level) => ({
              path: level.path,
              en: nameOf(level.path).en.trim(),
              ko: nameOf(level.path).ko.trim(),
            })),
        }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        createdPaths?: string[];
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'カテゴリを作成できませんでした');
      }
      // 一緒に作られた親階層も一覧に入れる。入れ忘れると、同じ親の下に続けて
      // もう 1 つ作るときに「作成対象の親階層ではありません」で拒否される
      created = result.createdPaths?.length ? result.createdPaths : requested;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'カテゴリを作成できませんでした');
      setCreating(false);
      return;
    }

    setAvailableAttributes((prev) => [...new Set([...prev, ...created])].sort());
    // 作った末尾と、その親の階層まで選ぶ。親が既にあって作られなかった場合も同じで、
    // ここで足さないと作った直後だけ親の抜けた選択になる
    setSelectedAttributes((prev) => selectCategoryPath(prev, submittedPath));
    for (const path of created) onCreateAttribute?.(path);
    onCategoriesChanged?.();
    resetCreateForm();
    setCreating(false);
    setShowCreateForm(false);
  };

  const handleApply = () => {
    onApply(selectedAttributes);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalWidthClass = modalSize === 'wide' ? 'max-w-4xl' : 'max-w-3xl';
  const gridColumnClass =
    listColumns === 4 ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-3' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={handleBackdropClick}
      />

      {/* Modal Container */}
      <div
        className="relative z-10 flex min-h-full items-center justify-center px-4 py-8 sm:py-12"
        onClick={handleBackdropClick}
      >
        {/* Modal Content — role="dialog" はフォーカストラップの範囲と一致させるためパネル側に置く */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="attributeModalTitle"
          tabIndex={-1}
          className={`w-full ${modalWidthClass} bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-5rem)] focus:outline-none`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
            <h3
              id="attributeModalTitle"
              className="text-lg font-bold text-gray-800 flex items-center gap-2"
            >
              <IconTags size="w-5 h-5" className="text-green-500" />
              カテゴリを管理
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <span className="sr-only">閉じる</span>
              <IconClose size="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Search and Create Button */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <IconSearch size="w-4 h-4" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label="カテゴリを検索"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="カテゴリを検索"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-green-300 bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
              >
                <IconPlusCircle size="w-4 h-4" />
                新しいカテゴリを作成
              </button>
            </div>

            {/* Create Form */}
            {showCreateForm && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                <div>
                  <label
                    htmlFor="attributeNewInput"
                    className="block text-sm font-medium text-green-900 mb-1"
                  >
                    新しいカテゴリ名（階層は「/」で区切る）
                  </label>
                  <input
                    type="text"
                    id="attributeNewInput"
                    value={newAttributeName}
                    disabled={creating}
                    onChange={(e) => setNewAttributeName(e.target.value)}
                    onKeyDown={(e) => {
                      // IME の変換確定 Enter で永続的な作成を走らせない
                      if (e.key === 'Enter' && !isComposingKeyboardEvent(e.nativeEvent)) {
                        e.preventDefault();
                        void handleCreateAttribute();
                      }
                    }}
                    className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例: 動物/ねこ"
                  />
                </div>
                {missingLevels.map((level) => (
                  <div key={level.path} className="rounded-lg border border-green-200 bg-green-50/60 p-3">
                    <p className="mb-2 text-sm font-medium text-green-900">
                      「{level.segment}」の名前
                      <span className="ml-2 text-xs font-normal text-green-800">
                        新しく作る階層（{level.path}）・対訳は任意
                      </span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`attributeNewEnInput-${level.path}`}
                          className="block text-sm font-medium text-green-900 mb-1"
                        >
                          英語名（任意）
                        </label>
                        <input
                          type="text"
                          id={`attributeNewEnInput-${level.path}`}
                          value={nameOf(level.path).en}
                          disabled={creating}
                          onChange={(e) => setNameOf(level.path, { en: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isComposingKeyboardEvent(e.nativeEvent)) {
                              e.preventDefault();
                              void handleCreateAttribute();
                            }
                          }}
                          className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="例: Cat"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`attributeNewKoInput-${level.path}`}
                          className="block text-sm font-medium text-green-900 mb-1"
                        >
                          韓国語名（任意）
                        </label>
                        <input
                          type="text"
                          id={`attributeNewKoInput-${level.path}`}
                          value={nameOf(level.path).ko}
                          disabled={creating}
                          onChange={(e) => setNameOf(level.path, { ko: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isComposingKeyboardEvent(e.nativeEvent)) {
                              e.preventDefault();
                              void handleCreateAttribute();
                            }
                          }}
                          className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="例: 고양이"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {newAttributeName.trim() !== '' && missingLevels.length === 0 && (
                  <p className="text-xs text-amber-800">
                    {createLevels.length === 0
                      ? '「/」の前後には階層の名前が必要です。例: 動物/ねこ'
                      : 'このカテゴリは既にあります。'}
                  </p>
                )}
                <p className="text-xs text-green-800">
                  英語名・韓国語名は後からでも登録できます。空のままなら、その階層は英語・韓国語のデータでも日本語のまま表示されます。上の階層の名前は自動で前に付き、既にあるカテゴリの分は入力欄が出ません。作成するとすぐに GitHub にコミットされます。
                </p>
                {createError && (
                  <p role="alert" className="text-sm text-red-600">
                    {createError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => {
                      setShowCreateForm(false);
                      resetCreateForm();
                    }}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => void handleCreateAttribute()}
                    className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                  >
                    {creating ? '作成中…' : '追加する'}
                  </button>
                </div>
              </div>
            )}

            {/* Attribute List */}
            <p className="text-xs text-gray-500">
              子の階層を選ぶと、上の階層も一緒に選ばれます。上の階層を外すと、その下も外れます。
            </p>
            <div className="border border-gray-200 rounded-2xl">
              <div className="max-h-[28.5rem] overflow-y-auto pr-1">
                <div className={gridColumnClass}>
                  {filteredAttributes.map((attr) => {
                    const isSelected = selectedAttributes.includes(attr);
                    return (
                      <button
                        key={attr}
                        type="button"
                        onClick={() => handleToggleAttribute(attr)}
                        className={`px-4 py-2 rounded-lg text-left transition-all ${
                          isSelected
                            ? 'bg-green-100 border-2 border-green-500 text-green-800 font-semibold'
                            : 'bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {isSelected
                          ? <IconCheckCircle size="w-4 h-4" className="mr-2 inline-block" />
                          : <IconCircle size="w-4 h-4" className="mr-2 inline-block" />
                        }
                        {attr}
                      </button>
                    );
                  })}
                </div>
              </div>
              {filteredAttributes.length === 0 && (
                <p className="px-4 pb-4 text-sm text-gray-500">
                  一致するカテゴリがありません。
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold shadow hover:opacity-90 transition-opacity"
            >
              選択を決定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
