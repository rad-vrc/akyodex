'use client';

import { AkyoCard, type AssignAction } from '@/components/akyo-card';
import { IconSave } from '@/components/icons';
import { SearchBar } from '@/components/search-bar';
import { MAX_BATCH_UPDATES, applyAkyoEditFields, type AkyoEditFields, type PendingAkyoUpdate } from '@/lib/akyo-edit-fields';
import { applyCategories, categoriesOf, changesUnderMode, hasAllCategories, stageCategoryUpdate, type CategoryAssignMode } from '@/lib/category-assignment';
import type { AkyoData } from '@/types/akyo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface CategoryAssignPanelProps {
  /** Catalog owned by AdminTabs; already carries rows committed by either tab. */
  akyoData: AkyoData[];
  /** Categories chosen in the list (AND) */
  selected: string[];
  /** The panel stays mounted (held changes survive selection changes); this shows or hides it. */
  visible: boolean;
  /** Ids the edit tab is holding; one row must not be held in two places (both stage `original`). */
  blockedIds: ReadonlySet<string>;
  onClearSelection: () => void;
  onPendingStateChange?: (pending: boolean, busy: boolean, pendingIds?: string[]) => void;
  /** Rows as the server saved them, with the snapshots they replaced, for the shared catalog. */
  onCommitted: (rows: AkyoData[], originals: AkyoEditFields[]) => void;
}

/** Cards mounted at once; the catalog is ~950 entries and the admin only looks at a screenful. */
const RENDER_STEP = 60;

/**
 * Bulk category assignment: every Akyo as a zukan card, the ones carrying every selected
 * category highlighted. **付ける／外すはモードで選ぶ。押したカードの状態では決めない。**
 * 押しても何も変わらないカード（付けるモードで既に全部持つ、外すモードで持っていない）は
 * 押せなくしてある。保留のあるカードだけは、取り消すために常に押せる。
 * The changes are committed together through the same batch API as the edit tab.
 */
export function CategoryAssignPanel({
  akyoData,
  selected,
  visible,
  blockedIds,
  onClearSelection,
  onPendingStateChange,
  onCommitted,
}: CategoryAssignPanelProps) {
  const [pending, setPending] = useState<Record<string, PendingAkyoUpdate>>({});
  const [mode, setMode] = useState<CategoryAssignMode>('attach');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [message, setMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState('');
  const [query, setQuery] = useState('');
  const [onlyMatching, setOnlyMatching] = useState(false);
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);
  const pendingKey = Object.keys(pending).sort().join(',');
  const pendingIds = useMemo(() => (pendingKey ? pendingKey.split(',') : []), [pendingKey]);
  const pendingCount = pendingIds.length;

  // カタログから消えた行（他で削除された、あるいは再取得したスナップショットに無い）は
  // カードが出ないので、押して取り消すことができない。だからといって黙って保留を捨てると
  // 触ったつもりの変更が理由も分からず消えるので、保留は残したまま、どの ID がそうなったかを
  // 知らせる。反映を押せばサーバが 409 で止めるので、そのまま壊れることはない
  const vanished = useMemo(() => {
    const ids = new Set(akyoData.map((akyo) => akyo.id));
    return Object.keys(pending).filter((id) => !ids.has(id));
  }, [akyoData, pending]);
  const vanishedKey = vanished.join(',');
  useEffect(() => {
    if (!vanishedKey) return;
    setMessage(
      `#${vanishedKey.split(',').join(' / #')} は一覧から消えました（他で削除された可能性）。` +
        '保留は残してあります。取り消す場合は保留を破棄してください。',
    );
  }, [vanishedKey]);

  const visibleData = useMemo(
    () => akyoData.map((akyo) => (pending[akyo.id] ? applyAkyoEditFields(akyo, pending[akyo.id].changes) : akyo)),
    [akyoData, pending],
  );

  /** Rows matching the selection right now (held changes included): highlight and count. */
  const matching = useMemo(
    () => new Set(visibleData.filter((akyo) => hasAllCategories(categoriesOf(akyo), selected)).map((akyo) => akyo.id)),
    [visibleData, selected],
  );
  /**
   * Rows that matched before the held changes. The "only matching" filter uses this so a card
   * does not vanish from under the pointer the moment it is toggled off.
   */
  const matchingBase = useMemo(
    () => new Set(akyoData.filter((akyo) => hasAllCategories(categoriesOf(akyo), selected)).map((akyo) => akyo.id)),
    [akyoData, selected],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visibleData.filter((akyo) => {
      if (onlyMatching && !matchingBase.has(akyo.id) && !pending[akyo.id]) return false;
      if (!needle) return true;
      return [akyo.id, akyo.nickname, akyo.avatarName, akyo.author || akyo.creator || ''].some((value) =>
        (value || '').toLowerCase().includes(needle),
      );
    });
  }, [visibleData, query, onlyMatching, matchingBase, pending]);

  useEffect(() => {
    setRenderLimit(RENDER_STEP);
  }, [query, onlyMatching, selected]);

  useLayoutEffect(() => {
    onPendingStateChange?.(pendingCount > 0, submitting, pendingIds);
  }, [pendingCount, pendingIds, submitting, onPendingStateChange]);

  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

  // The card list is long-lived, so the toggle handler must keep a stable identity or every
  // card re-renders on every state change (AkyoCard is memoized on its props). The latest
  // handler is published after the commit: writing a ref during render would leave the
  // closure of a render React threw away.
  const toggleRef = useRef<(akyo: AkyoData) => void>(() => {});
  useLayoutEffect(() => {
    toggleRef.current = (akyo: AkyoData) => {
      if (submitting) return;
      // A second click on a card undoes what the first one staged, whatever the selection is.
      if (pending[akyo.id]) {
        setPending((previous) => {
          const next = { ...previous };
          delete next[akyo.id];
          return next;
        });
        setMessage('');
        setCommitUrl('');
        return;
      }
      if (selected.length === 0) return;
      if (blockedIds.has(akyo.id)) {
        setMessage(`#${akyo.id} は編集・削除タブで保留中です。先にそちらを反映または取り消してください。`);
        return;
      }
      const base = akyoData.find((entry) => entry.id === akyo.id);
      if (!base) return;
      if (pendingCount >= MAX_BATCH_UPDATES) {
        setMessage(`保留は${MAX_BATCH_UPDATES}件までです。先に更新を反映してください。`);
        return;
      }
      const staged = stageCategoryUpdate(base, undefined, applyCategories(categoriesOf(akyo), selected, mode));
      if (!staged) return;
      setPending((previous) => ({ ...previous, [akyo.id]: staged }));
      setMessage('');
      setCommitUrl('');
    };
  });
  const handleToggle = useCallback((akyo: AkyoData) => toggleRef.current(akyo), []);

  const handleApply = async () => {
    if (submittingRef.current || !pendingCount) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage('');
    const applied = Object.values(pending);
    try {
      const response = await fetch('/api/update-akyo-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applied),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新に失敗しました');
      setPending({});
      setMessage(result.message);
      setCommitUrl(result.commitUrl || '');
      onCommitted(result.data as AkyoData[], applied.map((update) => update.original));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新に失敗しました。保留内容は維持されています。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Without a selection there is nothing to toggle, but a held card must stay revertible.
  // 押したときに何が起きるかを、カードの選択状態ではなくモードから決める。保留のある
  // カードは取り消すために常に押せる。それ以外で何も変わらないカードは押させない。
  // 付ける作業中に、既に全部持つカードを押して外れることが構造的に起きなくなる。
  // 表示するぶんだけ 1 回で求める（カードごとに 2 回呼ぶと categoriesOf と applyCategories
  // が二重に走る）
  const shown = useMemo(() => filtered.slice(0, renderLimit), [filtered, renderLimit]);
  const cardAction = useMemo(() => {
    const byId = new Map<string, AssignAction>();
    for (const akyo of shown) {
      if (pending[akyo.id]) byId.set(akyo.id, 'revert');
      else if (selected.length === 0) byId.set(akyo.id, 'none');
      else byId.set(akyo.id, changesUnderMode(categoriesOf(akyo), selected, mode) ? mode : 'none');
    }
    return byId;
  }, [shown, pending, selected, mode]);

  return (
    <section
      aria-label="カテゴリの付け外し"
      hidden={!visible}
      className="mb-6 rounded-xl border border-green-200 bg-green-50/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-green-900">選択中のカテゴリ（すべて持つ Akyo が選択状態）:</span>
        {selected.length === 0 && (
          <span className="text-sm text-gray-600">なし。一覧の「選択」でカテゴリを選ぶとカードを押せます</span>
        )}
        {selected.map((path) => (
          <span key={path} className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-900">
            {path}
          </span>
        ))}
        <button
          type="button"
          onClick={onClearSelection}
          disabled={submitting || selected.length === 0}
          className="ml-auto px-3 py-1.5 text-sm text-gray-600 underline underline-offset-4 disabled:opacity-50"
        >
          選択を解除
        </button>
      </div>
      {/* 押したカードの状態で向きを決めない。付ける作業の途中で、既に持っているカードを
          押して外れてしまう事故を構造的に無くす（#0926 で実際に起きた） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-green-900">カードを押したときの動作:</span>
        <div role="radiogroup" aria-label="カードを押したときの動作" className="inline-flex overflow-hidden rounded-lg border border-green-300">
          {([['attach', '付ける'], ['detach', '外す']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={submitting}
              onClick={() => setMode(value)}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                mode === value
                  ? value === 'detach'
                    ? 'bg-red-600 text-white'
                    : 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-700">
        {mode === 'attach'
          ? 'カードを押すと、選択中のカテゴリをまとめて付けます（親は自動で付きます）。すでに全部持つ Akyo は押せません。'
          : 'カードを押すと、選択中のカテゴリをまとめて外します（親を外すと配下も外れます）。一部だけ持つ Akyo も押せて、その分だけ外れます。一つも持たない Akyo は押せません。'}
        保留中のカードをもう一度押すと、その変更だけ取り消します。 該当 {matching.size} 件 / 全 {akyoData.length} 件
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

      <div className="text-sm text-gray-600 mb-2">
        {filtered.length} 件中 {shown.length} 件を表示
      </div>
      {/* Only render the grid while the panel is on screen: the catalog is ~950 cards. */}
      {visible && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((akyo) => (
              <AkyoCard
                key={akyo.id}
                akyo={akyo}
                selectedForAssign={matching.has(akyo.id)}
                assignAction={cardAction.get(akyo.id) ?? 'none'}
                assignDisabled={submitting || (cardAction.get(akyo.id) ?? 'none') === 'none'}
                assignPending={Boolean(pending[akyo.id])}
                onAssignToggle={handleToggle}
              />
            ))}
          </div>
          {shown.length < filtered.length && (
            <button
              type="button"
              onClick={() => setRenderLimit((value) => value + RENDER_STEP)}
              className="mt-4 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              もっと見る（残り {filtered.length - shown.length} 件）
            </button>
          )}
        </>
      )}

      <div className="sticky bottom-0 z-30 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 bg-white py-4">
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
