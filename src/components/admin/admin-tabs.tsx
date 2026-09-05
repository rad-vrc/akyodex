'use client';

import { IconEdit, IconPlusCircle, IconTags, IconTools } from '@/components/icons';
import { useCallback, useState } from 'react';
import { extractCategories, extractAuthors } from '@/lib/akyo-data-helpers';
import { AddTab } from './tabs/add-tab';
import { CategoriesTab } from './tabs/categories-tab';
import { EditTab } from './tabs/edit-tab';
import { ToolsTab } from './tabs/tools-tab';

import type { AdminRole, AkyoData } from '@/types/akyo';

interface AdminTabsProps {
  userRole: AdminRole;
  attributes: string[];
  creators: string[];
  akyoData: AkyoData[];
  onPendingEditsChange?: (pending: boolean, busy: boolean) => void;
}

type TabType = 'add' | 'edit' | 'categories' | 'tools';

/**
 * Admin Tabs Component
 * 管理画面のタブナビゲーション（完全再現）
 */
export function AdminTabs({ userRole, attributes, creators, akyoData, onPendingEditsChange }: AdminTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('add');
  const [editVisited, setEditVisited] = useState(false);
  const [applying, setApplying] = useState(false);
  const [refreshedCatalog, setRefreshedCatalog] = useState<AkyoData[] | null>(null);
  const currentAttributes = refreshedCatalog ? extractCategories(refreshedCatalog) : attributes;
  const currentCreators = refreshedCatalog ? extractAuthors(refreshedCatalog) : creators;
  const handlePendingState = useCallback((pending: boolean, busy: boolean) => {
    setApplying(busy);
    onPendingEditsChange?.(pending, busy);
  }, [onPendingEditsChange]);

  const handleTabChange = (nextTab: TabType) => {
    if (applying) return;
    if (nextTab === 'edit') setEditVisited(true);
    setActiveTab(nextTab);
  };

  const handleDataChange = () => {
    // For now, just show a message that page needs refresh
    // In production, this would trigger a router refresh or data revalidation
    alert('データが更新されました。\nページを再読み込みして最新のデータを表示してください。');
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* タブナビゲーション */}
      <div className="bg-white rounded-xl shadow-lg mb-6">
        <div className="flex border-b">
          <button
            onClick={() => handleTabChange('add')}
            disabled={applying}
            className={`px-6 py-4 font-medium text-gray-700 transition-colors ${
              activeTab === 'add'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'hover:bg-gray-50'
            }`}
          >
            <IconPlusCircle size="w-4 h-4" className="mr-2" />
            新規登録
          </button>
          <button
            onClick={() => handleTabChange('edit')}
            disabled={applying}
            className={`px-6 py-4 font-medium text-gray-700 transition-colors ${
              activeTab === 'edit'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'hover:bg-gray-50'
            }`}
          >
            <IconEdit size="w-4 h-4" className="mr-2" />
            編集・削除
          </button>
          <button
            onClick={() => handleTabChange('categories')}
            disabled={applying}
            className={`px-6 py-4 font-medium text-gray-700 transition-colors ${
              activeTab === 'categories'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'hover:bg-gray-50'
            }`}
          >
            <IconTags size="w-4 h-4" className="mr-2" />
            カテゴリ
          </button>
          <button
            onClick={() => handleTabChange('tools')}
            disabled={applying}
            className={`px-6 py-4 font-medium text-gray-700 transition-colors ${
              activeTab === 'tools'
                ? 'border-b-2 border-red-500 text-red-500'
                : 'hover:bg-gray-50'
            }`}
          >
            <IconTools size="w-4 h-4" className="mr-2" />
            ツール
          </button>
        </div>
      </div>

      {/* タブコンテンツ */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        {/* Keep registration state, including image/crop state, across tab switches. */}
        <div hidden={activeTab !== 'add'}>
          <AddTab
            userRole={userRole}
            attributes={currentAttributes}
            creators={currentCreators}
          />
        </div>
        {editVisited && (
          <div hidden={activeTab !== 'edit'}>
          <EditTab
            userRole={userRole}
            akyoData={akyoData}
            attributes={currentAttributes}
            onCatalogRefresh={setRefreshedCatalog}
            onDataChange={handleDataChange}
            onPendingStateChange={handlePendingState}
          />
          </div>
        )}
        {activeTab === 'categories' && <CategoriesTab userRole={userRole} />}
        {activeTab === 'tools' && <ToolsTab />}
      </div>
    </div>
  );
}
