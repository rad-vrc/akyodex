'use client';

import { AkyoCard } from '@/components/akyo-card';
import { IconSave } from '@/components/icons';
import { SearchBar } from '@/components/search-bar';
import { MAX_BATCH_UPDATES, applyAkyoEditFields, type PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import { categoriesOf, hasAllCategories, stageCategoryUpdate, toggleCategories } from '@/lib/category-assignment';
import type { AkyoData } from '@/types/akyo';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface CategoryAssignPanelProps {
  akyoData: AkyoData[];
  /** Categories chosen in the list (AND) */
  selected: string[];
  onClearSelection: () => void;
  onPendingStateChange?: (pending: boolean, busy: boolean) => void;
}

/**
 * Bulk category assignment: every Akyo as a zukan card, the ones carrying every selected
 * category highlighted. Clicking a card toggles the whole set (with ancestors when adding,
 * with descendants when removing); the changes are held and committed together through
 * the same batch API as the edit tab.
 */
export function CategoryAssignPanel({ akyoData, selected, onClearSelection, onPendingStateChange }: CategoryAssignPanelProps) {
  const [pending, setPending] = useState<Record<string, PendingAkyoUpdate>>({});
  const [saved, setSaved] = useState<Record<string, AkyoData>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [message, setMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState('');
  const [query, setQuery] = useState('');
  const [onlyMatching, setOnlyMatching] = useState(false);
  const pendingCount = Object.keys(pending).length;

  const visibleData = useMemo(
    () =>
      akyoData.map((akyo) => {
        const current = saved[akyo.id] ?? akyo;
        return pending[akyo.id] ? applyAkyoEditFields(current, pending[akyo.id].changes) : current;
      }),
    [akyoData, pending, saved],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visibleData.filter((akyo) => {
      if (onlyMatching && !hasAllCategories(categoriesOf(akyo), selected)) return false;
      if (!needle) return true;
      return [akyo.id, akyo.nickname, akyo.avatarName, akyo.author || akyo.creator || '']
        .some((value) => (value || '').toLowerCase().includes(needle));
    });
  }, [visibleData, query, onlyMatching, selected]);

  const matchingCount = useMemo(
    () => visibleData.filter((akyo) => hasAllCategories(categoriesOf(akyo), selected)).length,
    [visibleData, selected],
  );

  useLayoutEffect(() => {
    onPendingStateChange?.(pendingCount > 0, submitting);
  }, [pendingCount, submitting, onPendingStateChange]);

  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  const handleToggle = (akyo: AkyoData) => {
    if (submitting) return;
    const base = saved[akyo.id] ?? akyoData.find((entry) => entry.id === akyo.id);
    if (!base) return;
    if (!pending[akyo.id] && pendingCount >= MAX_BATCH_UPDATES) {
      setMessage(`保留は${MAX_BATCH_UPDATES}件までです。先に更新を反映してください。`);
      return;
    }
    const next = toggleCategories(categoriesOf(akyo), selected);
    setPending((previous) => {
      const staged = stageCategoryUpdate(base, previous[akyo.id], next);
      const result = { ...previous };
      if (staged) result[akyo.id] = staged;
      else delete result[akyo.id];
      return result;
    });
    setMessage('');
    setCommitUrl('');
  };

  const handleApply = async () => {
    if (submittingRef.current || !pendingCount) return;
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
      setSaved((previous) => ({
        ...previous,
        ...Object.fromEntries((result.data as AkyoData[]).map((akyo) => [akyo.id, akyo])),
      }));
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

  return (
    <section aria-label="カテゴリの付け外し" className="mb-6 rounded-xl border border-green-200 bg-green-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-green-900">選択中のカテゴリ（すべて持つ Akyo が選択状態）:</span>
        {selected.map((path) => (
          <span key={path} className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-900">
            {path}
          </span>
        ))}
        <button
          type="button"
          onClick={onClearSelection}
          disabled={submitting || pendingCount > 0}
          title={pendingCount > 0 ? '保留中の更新を反映または取り消してから解除してください' : undefined}
          className="ml-auto px-3 py-1.5 text-sm text-gray-600 underline underline-offset-4 disabled:opacity-50"
        >
          選択を解除
        </button>
      </div>
      <p className="mb-3 text-sm text-gray-700">
        カードを押すと、選択中のカテゴリをまとめて付けます（親は自動で付きます）。すでに全部持つ Akyo を押すと、まとめて外します（親を外すと配下も外れます）。
        該当 {matchingCount} 件 / 全 {akyoData.length} 件
      </p>
      <fieldset disabled={submitting} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="category-assign-search" className="sr-only">Akyo を検索</label>
          <SearchBar id="category-assign-search" value={query} onSearch={setQuery} placeholder="ID、名前、アバター名、作者で検索" ariaLabel="Akyo を検索" disabled={submitting} />
        </div>
        <button
          type="button"
          aria-pressed={onlyMatching}
          onClick={() => setOnlyMatching((value) => !value)}
          className={`attribute-badge quick-filter-badge transition-colors ${onlyMatching ? 'bg-green-200 text-green-900 hover:bg-green-300' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
        >
          該当する Akyo のみ
        </button>
      </fieldset>

      <div className="text-sm text-gray-600 mb-2">{filtered.length} 件を表示</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((akyo) => (
          <AkyoCard
            key={akyo.id}
            akyo={akyo}
            selection={{ selected: hasAllCategories(categoriesOf(akyo), selected), onToggle: () => handleToggle(akyo) }}
          />
        ))}
      </div>

      <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 bg-white py-4">
        <p role="status" className="min-w-0 flex-1 text-sm text-gray-700 break-words">
          {message}
          {commitUrl && <a className="ml-2 text-blue-700 underline" href={commitUrl} target="_blank" rel="noopener noreferrer">コミット</a>}
        </p>
        <span className="text-sm text-gray-700">保留 {pendingCount}件</span>
        <button type="button" disabled={submitting || !pendingCount} className="px-3 py-2 text-sm text-gray-600 disabled:opacity-50" onClick={() => {
          if (confirm('保留中の更新をすべて取り消しますか？')) setPending({});
        }}>すべて取り消す</button>
        <button type="button" onClick={() => void handleApply()} disabled={submitting || !pendingCount} aria-busy={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500 px-5 py-3 font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
          <IconSave size="w-4 h-4" />{submitting ? '反映中...' : 'カテゴリの変更を反映する'}
        </button>
      </div>
    </section>
  );
}
