'use client';

import { IconEdit, IconInfoCircle, IconSearch, IconTrash } from '@/components/icons';
import { getAkyoSourceUrl } from '@/lib/akyo-entry';
import { generateBlurDataURL } from '@/lib/blur-data-url';
import { buildAvatarImageUrl } from '@/lib/vrchat-utils';
import type { AdminRole, AkyoData } from '@/types/akyo';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import { EditModal } from '../edit-modal';

interface EditTabProps {
  userRole: AdminRole;
  akyoData: AkyoData[];
  attributes: string[];
  onDataChange: () => void;
}

/**
 * Edit Tab Component
 * 編集・削除タブ（完全再現）
 */
export function EditTab({ userRole, akyoData, attributes, onDataChange }: EditTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAkyo, setSelectedAkyo] = useState<AkyoData | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) {
      return akyoData;
    }

    const query = searchQuery.toLowerCase();
    return akyoData.filter((akyo) => {
      return (
        akyo.id.toLowerCase().includes(query) ||
        (akyo.nickname && akyo.nickname.toLowerCase().includes(query)) ||
        (akyo.avatarName && akyo.avatarName.toLowerCase().includes(query)) ||
        (akyo.creator && akyo.creator.toLowerCase().includes(query))
      );
    });
  }, [akyoData, searchQuery]);

  const handleEdit = (akyo: AkyoData) => {
    setSelectedAkyo(akyo);
    setShowEditModal(true);
  };

  const handleDelete = async (akyo: AkyoData) => {
    if (!confirm(
      `本当に削除しますか？\n\n` +
      `ID: #${akyo.id}\n` +
      `アバター名: ${akyo.avatarName}\n` +
      `作者: ${akyo.creator}\n\n` +
      `この操作は取り消せません。`
    )) {
      return;
    }

    try {
      const response = await fetch('/api/delete-akyo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: akyo.id,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'サーバーエラーが発生しました');
      }

      alert(
        `✅ ${result.message}\n\n` +
        (result.commitUrl ? `コミット: ${result.commitUrl}` : '')
      );

      // Refresh data
      onDataChange();

    } catch (error) {
      console.error('Delete error:', error);
      alert(
        '❌ 削除に失敗しました\n\n' +
        (error instanceof Error ? error.message : '不明なエラーが発生しました') +
        '\n\nもう一度お試しください。'
      );
    }
  };

  const handleEditSuccess = () => {
    onDataChange();
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-6">
        <IconEdit size="w-5 h-5" className="text-red-500 mr-2" /> Akyoを編集・削除
      </h2>

      {/* 検索 */}
      <div className="mb-6">
        <label htmlFor="edit-tab-search" className="sr-only">
          Akyoを検索
        </label>
        <div className="relative">
          <IconSearch size="w-4 h-4" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="edit-tab-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="ID、名前、アバター名、作者で検索"
          />
        </div>
      </div>

      {/* 件数表示 */}
      <div className="mb-4 text-sm text-gray-600">
        全{akyoData.length}件中 {filteredData.length}件を表示
      </div>

      {/* 編集リスト */}
      <div className="border border-gray-200 rounded-lg">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  画像
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名前
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  アバター名
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  作者
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    <IconSearch size="w-10 h-10" className="mb-2 mx-auto block" />
                    {searchQuery ? '検索結果がありません' : 'データがありません'}
                  </td>
                </tr>
              ) : (
                filteredData.map((akyo) => (
                  <tr key={akyo.id} className="hover:bg-gray-50">
                    {/* 画像 */}
                    <td className="px-4 py-3">
                      <Image
                        src={buildAvatarImageUrl(akyo.id, getAkyoSourceUrl(akyo), 64)}
                        alt={akyo.avatarName || akyo.nickname}
                        width={48}
                        height={48}
                        className="w-12 h-12 object-cover rounded"
                        unoptimized
                        placeholder="blur"
                        blurDataURL={generateBlurDataURL(akyo.id)}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = '/images/placeholder.webp';
                        }}
                      />
                    </td>

                    {/* ID */}
                    <td className="px-4 py-3 font-mono text-sm">
                      #{akyo.id}
                    </td>

                    {/* 通称 */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {akyo.nickname || '-'}
                      </div>
                    </td>

                    {/* アバター名 */}
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">
                        {akyo.avatarName}
                      </div>
                    </td>

                    {/* 作者 */}
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {akyo.creator}
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(akyo)}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                        >
                          <IconEdit size="w-3.5 h-3.5" className="mr-1" />
                          編集
                        </button>
                        {userRole === 'owner' && (
                          <button
                            onClick={() => handleDelete(akyo)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                          >
                            <IconTrash size="w-3.5 h-3.5" className="mr-1" />
                            削除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-sm text-gray-600">
        <IconInfoCircle size="w-4 h-4" className="mr-1" />
        {userRole === 'owner' ? '編集・削除機能が利用可能です' : '編集機能が利用可能です（削除は上位管理者のみ）'}
      </p>

      {/* Edit Modal */}
      <EditModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAkyo(null);
        }}
        akyo={selectedAkyo}
        attributes={attributes}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
