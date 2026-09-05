'use client';

import { IconCheckCircle, IconCircle, IconClose, IconPlusCircle, IconSearch, IconTags } from '@/components/icons';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import { useState, useEffect, useRef } from 'react';

interface AttributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAttributes: string[];
  onApply: (attributes: string[]) => void;
  allAttributes: string[];
  onCreateAttribute?: (attribute: string) => void;
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
  listColumns = 3,
  modalSize = 'default',
}: AttributeModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAttributeName, setNewAttributeName] = useState('');
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

  const handleToggleAttribute = (attr: string) => {
    setSelectedAttributes((prev) => {
      if (prev.includes(attr)) {
        return prev.filter((a) => a !== attr);
      } else {
        return [...prev, attr];
      }
    });
  };

  const handleCreateAttribute = () => {
    const trimmed = newAttributeName.trim();
    if (!trimmed) {
      alert('カテゴリ名を入力してください');
      return;
    }

    // Check for duplicates with Unicode normalization (NFC)
    const normalizedInput = trimmed.normalize('NFC');
    const isDuplicate = availableAttributes.some(
      attr => attr.normalize('NFC').toLowerCase() === normalizedInput.toLowerCase()
    );

    if (isDuplicate) {
      alert('このカテゴリは既に存在します');
      return;
    }

    setAvailableAttributes((prev) => [...prev, trimmed].sort());
    setSelectedAttributes((prev) => [...prev, trimmed]);
    onCreateAttribute?.(trimmed);
    setNewAttributeName('');
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
                    新しいカテゴリ名
                  </label>
                  <input
                    type="text"
                    id="attributeNewInput"
                    value={newAttributeName}
                    onChange={(e) => setNewAttributeName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleCreateAttribute();
                      }
                    }}
                    className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="例: チョコミント類"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setNewAttributeName('');
                    }}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateAttribute}
                    className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600"
                  >
                    追加する
                  </button>
                </div>
              </div>
            )}

            {/* Attribute List */}
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
