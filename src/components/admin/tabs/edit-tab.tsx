'use client';

import { IconEdit, IconInfoCircle, IconSearch, IconTrash, IconSave, IconClose, IconRedo, IconGlobe, IconShoppingBag, IconClipboardClock } from '@/components/icons';
import { FilterPanel } from '@/components/filter-panel';
import { SortControls } from '@/components/sort-controls';
import { SearchBar } from '@/components/search-bar';
import { filterCatalog } from '@/lib/catalog-filter';
import { extractCategories, extractAuthors } from '@/lib/akyo-data-helpers';
import { loadLatestAdminCatalog } from '@/app/zukan/catalog-data-loader';
import { MAX_BATCH_UPDATES, applyAkyoEditFields, getAkyoEditFields, sameAkyoEditFields, type AkyoEditFields, type PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import { getAkyoSourceUrl } from '@/lib/akyo-entry';
import { generateBlurDataURL } from '@/lib/blur-data-url';
import { buildAvatarImageUrl } from '@/lib/vrchat-utils';
import type { AdminRole, AkyoData, AkyoEntryType } from '@/types/akyo';
import Image from 'next/image';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditModal } from '../edit-modal';

interface EditTabProps {
  userRole: AdminRole;
  akyoData: AkyoData[];
  attributes: string[];
  onDataChange: () => void;
  onPendingStateChange?: (pending: boolean, busy: boolean) => void;
  onCatalogRefresh?: (data: AkyoData[]) => void;
}

interface SavedAkyoUpdate {
  data: AkyoData;
  before: AkyoEditFields[];
}

/**
 * Edit Tab Component
 * 編集・削除タブ（完全再現）
 */
export function EditTab({ userRole, akyoData, attributes, onDataChange, onPendingStateChange, onCatalogRefresh }: EditTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [categoryMatchMode, setCategoryMatchMode] = useState<'or' | 'and'>('or');
  const [sortAscending, setSortAscending] = useState(true);
  const [latestMode, setLatestMode] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [entryTypeFilter, setEntryTypeFilter] = useState<AkyoEntryType>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [catalogData, setCatalogData] = useState(akyoData);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const refreshController = useRef<AbortController | null>(null);
  const [selectedAkyo, setSelectedAkyo] = useState<AkyoData | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingAkyoUpdate>>({});
  const [saved, setSaved] = useState<Record<string, SavedAkyoUpdate>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [message, setMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState('');
  const pendingCount = Object.keys(pending).length;
  const visibleData = useMemo(() => catalogData.map((akyo) => {
    const current = saved[akyo.id]?.data ?? akyo;
    const item = pending[akyo.id] ? applyAkyoEditFields(current, pending[akyo.id].changes) : current;
    // Pending edits invalidate the public catalog's precomputed search fields.
    return { ...item, parsedCategory: undefined, parsedAuthor: undefined, _searchIndex: undefined };
  }), [catalogData, pending, saved]);
  const editAttributes = useMemo(() => [...new Set([
    ...attributes,
    ...extractCategories(catalogData),
    ...extractCategories(visibleData),
  ])], [attributes, catalogData, visibleData]);
  const editAuthors = useMemo(() => [...new Set([...extractAuthors(catalogData), ...extractAuthors(visibleData)])].sort(), [catalogData, visibleData]);

  useEffect(() => () => refreshController.current?.abort(), []);

  const handleRefresh = async () => {
    if (refreshController.current || submittingRef.current || showEditModal) return;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true);
    setRefreshMessage('');
    try {
      const next = await loadLatestAdminCatalog(controller.signal);
      if (controller.signal.aborted) return;
      // Keep pending rows even if they disappeared remotely; the server must
      // still reject their original snapshot rather than silently dropping them.
      const ids = new Set(next.map(item => item.id));
      const retained = catalogData.filter(item => pending[item.id] && !ids.has(item.id));
      setCatalogData([...next, ...retained]);
      setSaved(previous => Object.fromEntries(Object.entries(previous).filter(([id, item]) => {
        const remote = next.find(candidate => candidate.id === id);
        if (!remote) return false;
        const fields = getAkyoEditFields(remote);
        // Ignore only known pre-save snapshots while JSON sync catches up.
        // Matching the saved result, or a different external edit, retires the overlay.
        return !sameAkyoEditFields(getAkyoEditFields(item.data), fields)
          && item.before.some(before => sameAkyoEditFields(before, fields));
      })));
      onCatalogRefresh?.(next);
      setRefreshMessage('データを再取得しました。');
    } catch {
      if (!controller.signal.aborted) setRefreshMessage('再取得に失敗しました。現在のデータと保留内容は維持されています。');
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
      refreshController.current = null;
    }
  };

  // Publish the navigation guard before the pending/busy UI becomes interactive.
  useLayoutEffect(() => {
    onPendingStateChange?.(pendingCount > 0, submitting || refreshing);
  }, [pendingCount, submitting, refreshing, onPendingStateChange]);

  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  const handleStage = (changes: AkyoEditFields) => {
    if (!pending[changes.id] && pendingCount >= MAX_BATCH_UPDATES) {
      throw new Error('保留は100件までです。先に更新を反映してください。');
    }
    const originalData = saved[changes.id]?.data ?? catalogData.find((akyo) => akyo.id === changes.id);
    if (!originalData) return;
    setPending((previous) => {
      const original = previous[changes.id]?.original ?? getAkyoEditFields(originalData);
      const next = { ...previous };
      if (sameAkyoEditFields(original, changes)) delete next[changes.id];
      else next[changes.id] = { original, changes };
      return next;
    });
    setMessage('');
    setCommitUrl('');
  };

  const handleApply = async () => {
    if (submittingRef.current || refreshController.current || !pendingCount) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/update-akyo-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.values(pending)),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新に失敗しました');
      setSaved((previous) => ({ ...previous, ...Object.fromEntries((result.data as AkyoData[]).map((akyo) => [akyo.id, {
        data: akyo,
        // Consecutive saves may all land before the public snapshot is updated.
        before: [...(previous[akyo.id]?.before ?? []), pending[akyo.id].original],
      }])) }));
      setPending({});
      setMessage(result.message);
      setCommitUrl(result.commitUrl || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新に失敗しました。保留内容は維持されています。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const filteredData = useMemo(() => filterCatalog(pendingOnly ? visibleData.filter(item => pending[item.id]) : visibleData, latestMode
    ? { latestCount: 100, entryTypeFilter }
    : { searchQuery, categories: selectedCategories, authors: selectedAuthors, categoryMatchMode, entryTypeFilter },
  sortAscending), [visibleData, pendingOnly, pending, latestMode, entryTypeFilter, searchQuery, selectedCategories, selectedAuthors, categoryMatchMode, sortAscending]);

  const handleLatestClick = () => {
    if (!latestMode) {
      setPendingOnly(false);
      setSearchQuery('');
      setSelectedCategories([]);
      setSelectedAuthors([]);
      setCategoryMatchMode('or');
    }
    setLatestMode(value => !value);
  };

  const handleEdit = (akyo: AkyoData) => {
    if (refreshController.current || submittingRef.current) return;
    setSelectedAkyo(akyo);
    setShowEditModal(true);
  };

  const handleDelete = async (akyo: AkyoData) => {
    if (refreshController.current || submittingRef.current) return;
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-800">
          <IconEdit size="w-5 h-5" className="text-red-500 mr-2" /> Akyoを編集・削除
        </h2>
        <button type="button" onClick={handleRefresh} disabled={refreshing || submitting || showEditModal}
          aria-label="最新データを再取得" title="最新データを再取得"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <IconRedo size="w-5 h-5" className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      {refreshMessage && <p role="status" className="mb-4 text-sm text-gray-700">{refreshMessage}</p>}

      <fieldset disabled={refreshing || submitting} aria-busy={refreshing || submitting} className="mb-6 space-y-4 min-w-0">
        <label htmlFor="edit-tab-search" className="sr-only">Akyoを検索</label>
        <SearchBar id="edit-tab-search" value={searchQuery} onSearch={value => { setLatestMode(false); setSearchQuery(value); }}
          placeholder="ID、名前、アバター名、作者で検索" ariaLabel="Akyoを検索" disabled={refreshing || submitting} />
        <button type="button" aria-expanded={filtersOpen} aria-controls="admin-edit-filter-panel"
          onClick={() => setFiltersOpen(value => !value)}
          className="text-sm font-medium text-gray-700 underline underline-offset-4">
          {filtersOpen ? '絞り込みを閉じる' : '絞り込みを開く'}
          {selectedCategories.length + selectedAuthors.length > 0 && ` (${selectedCategories.length + selectedAuthors.length})`}
        </button>
        <div id="admin-edit-filter-panel" hidden={!filtersOpen}>
          <FilterPanel attributes={editAttributes} creators={editAuthors}
            selectedAttributes={selectedCategories} selectedCreators={selectedAuthors}
            categoryMatchMode={categoryMatchMode}
            onAttributesChange={values => { setLatestMode(false); setSelectedCategories(values); }}
            onCreatorsChange={values => { setLatestMode(false); setSelectedAuthors(values); }}
            onCategoryMatchModeChange={value => { setLatestMode(false); setCategoryMatchMode(value); }}
            disabled={refreshing || submitting} />
        </div>
        <SortControls sortAscending={sortAscending} latestMode={latestMode}
          onSortToggle={() => setSortAscending(value => !value)} onLatestClick={handleLatestClick}
          disabled={refreshing || submitting}>
          <button type="button" aria-pressed={pendingOnly} aria-label="編集保留中の表示切り替え"
            title="編集保留中のAkyoのみ表示"
            onClick={() => { setLatestMode(false); setPendingOnly(value => !value); }}
            className={`attribute-badge quick-filter-badge transition-colors ${pendingOnly
              ? 'bg-amber-200 text-amber-900 hover:bg-amber-300'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
            <IconClipboardClock size="w-4 h-4" /> 編集保留中
          </button>
        </SortControls>
        <div className="flex flex-wrap gap-3 border-t border-gray-200 pt-4">
          <button type="button" title="アバターのみ" aria-label="アバターのみ" aria-pressed={entryTypeFilter === 'avatar'}
            className={`view-toggle-btn ${entryTypeFilter === 'avatar' ? 'active' : ''}`}
            onClick={() => setEntryTypeFilter(value => value === 'avatar' ? undefined : 'avatar')}>
            <Image src="/images/profileIcon.webp" alt="" width={24} height={24} unoptimized className="rounded-full" />
          </button>
          <button type="button" title="ワールドのみ" aria-label="ワールドのみ" aria-pressed={entryTypeFilter === 'world'}
            className={`view-toggle-btn ${entryTypeFilter === 'world' ? 'active' : ''}`}
            onClick={() => setEntryTypeFilter(value => value === 'world' ? undefined : 'world')}>
            <IconGlobe size="w-5 h-5" />
          </button>
          <button type="button" title="BOOTH商品のみ" aria-label="BOOTH商品のみ" aria-pressed={selectedCategories.includes('Booth')}
            className={`view-toggle-btn ${selectedCategories.includes('Booth') ? 'active' : ''}`}
            onClick={() => { setLatestMode(false); setSelectedCategories(values => values.includes('Booth') ? values.filter(value => value !== 'Booth') : [...values, 'Booth']); }}>
            <IconShoppingBag size="w-5 h-5" />
          </button>
        </div>
      </fieldset>

      {/* 件数表示 */}
      <div className="mb-4 text-sm text-gray-600">
        全{catalogData.length}件中 {filteredData.length}件を表示
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
                      {pending[akyo.id] && <span className="text-xs font-medium text-amber-700">更新保留中</span>}
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
                          disabled={submitting || refreshing}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <IconEdit size="w-3.5 h-3.5" className="mr-1" />
                          編集
                        </button>
                        {pending[akyo.id] && (
                          <button
                            type="button"
                            disabled={submitting || refreshing}
                            aria-label={`#${akyo.id} の保留を取り消す`}
                            title="保留を取り消す"
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                            onClick={() => setPending((previous) => {
                              const next = { ...previous };
                              delete next[akyo.id];
                              return next;
                            })}
                          ><IconClose size="w-4 h-4" /></button>
                        )}
                        {userRole === 'owner' && (
                          <button
                            onClick={() => handleDelete(akyo)}
                            disabled={submitting || refreshing || pendingCount > 0}
                            title={pendingCount ? '保留中の更新を反映または取り消してから削除してください' : undefined}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 bg-white py-4">
        <p role="status" className="min-w-0 flex-1 text-sm text-gray-700 break-words">
          {message}
          {commitUrl && <a className="ml-2 text-blue-700 underline" href={commitUrl} target="_blank" rel="noopener noreferrer">コミット</a>}
        </p>
        <span className="text-sm text-gray-700">保留 {pendingCount}件</span>
        <button type="button" disabled={submitting || refreshing || !pendingCount} className="px-3 py-2 text-sm text-gray-600 disabled:opacity-50" onClick={() => {
          if (confirm('保留中の更新をすべて取り消しますか？')) setPending({});
        }}>すべて取り消す</button>
        <button type="button" onClick={handleApply} disabled={submitting || refreshing || !pendingCount}
          aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500 px-5 py-3 font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
          <IconSave size="w-4 h-4" />{submitting ? '反映中...' : '更新を反映する'}
        </button>
      </div>

      {/* Edit Modal — key で対象ごとに作り直し、フォーム初期値・画像プレビュー・
          重複確認結果を前回の編集から引き継がないようにする */}
      <EditModal
        key={selectedAkyo?.id ?? 'closed'}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAkyo(null);
        }}
        akyo={selectedAkyo}
        attributes={editAttributes}
        onStage={handleStage}
      />
    </div>
  );
}
