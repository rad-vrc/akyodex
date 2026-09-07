'use client';

import { IconPlusCircle, IconRedo, IconTags } from '@/components/icons';
import { SearchBar } from '@/components/search-bar';
import type { CategoryRowChange } from '@/lib/admin-catalog';
import type { AkyoEditFields } from '@/lib/akyo-edit-fields';
import { planCategoryCreateLevels } from '@/lib/category-create-levels';
import { isProtectedCategoryPath } from '@/lib/category-operations';
import type { AdminRole, AkyoData } from '@/types/akyo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CategoryAssignPanel } from '../category-assign-panel';

interface CategoriesTabProps {
  userRole: AdminRole;
  /** Called after a commit so the add/edit tabs can pick up new or renamed categories. */
  onCategoriesChanged?: () => void;
  /** Catalog for bulk assignment (cards). Without it the tab only manages the categories. */
  akyoData?: AkyoData[];
  onPendingStateChange?: (pending: boolean, busy: boolean, pendingIds?: string[]) => void;
  /** Rows the edit tab is holding; they must not be staged here as well. */
  blockedIds?: ReadonlySet<string>;
  /** Rows as the server saved them, with the snapshots they replaced, for the shared catalog. */
  onRowsCommitted?: (rows: AkyoData[], originals: AkyoEditFields[]) => void;
  /** Category cells a rename, merge or delete rewrote, so the catalog follows without a refetch. */
  onCategoryRowsChanged?: (changes: CategoryRowChange[]) => void;
  /** Whether the tab is on screen; the list reloads when it comes back. */
  active?: boolean;
}

interface CategoryEntry {
  path: string;
  en: string | null;
  ko: string | null;
  count: number;
}

interface CategoryListResponse {
  success: boolean;
  error?: string;
  head?: string;
  categories?: CategoryEntry[];
  colors?: Record<string, string>;
}

interface CategoryMutationResponse {
  success: boolean;
  error?: string;
  message?: string;
  commitUrl?: string;
  changedRows?: number;
  updatedRows?: CategoryRowChange[];
}

/**
 * `head` is the commit the list showed when the form was opened. It travels with the form,
 * not with the list: refreshing the list while a form is open must not lend the form a newer
 * head, or a stale translation typed before the refresh would pass the server's check.
 */
type EditorTarget =
  | { kind: 'create'; parent: string | null }
  | { kind: 'rename'; path: string }
  | { kind: 'merge'; path: string };
type Editor = EditorTarget & { head: string };

const OWNER_ONLY_TITLE = '改名・統合・削除はらど（上位管理者）のみ使用できます';
const LOCKED_TITLE = '保留中のカテゴリ変更を反映または取り消してから操作してください';
const PROTECTED_TITLE = 'アプリが自動で付けるカテゴリなので、ここでは付け外しできません';
const EMPTY_IDS: ReadonlySet<string> = new Set();

function depthOf(path: string): number {
  return path.split('/').length - 1;
}

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index < 0 ? null : path.slice(0, index);
}

/**
 * Whether submitting this form would rewrite category tokens on Akyo rows. Creating a
 * category and registering a translation do not, so they stay available while assignments
 * are held; renaming to a new path, merging and deleting do.
 */
function changesCategoryTokens(editor: Editor, japaneseName: string): boolean {
  if (editor.kind === 'merge') return true;
  return editor.kind === 'rename' && japaneseName.trim() !== editor.path;
}

function isSelfOrDescendant(token: string, path: string): boolean {
  return token === path || token.startsWith(`${path}/`);
}

/**
 * Categories Tab
 * カテゴリタブ: 階層ごとの作成・改名（対訳の更新）・統合・削除。
 *
 * 一覧は /api/categories から毎回取り直す（管理画面の初期データは JSON 経由で遅れるため、
 * GitHub の CSV と対訳 JSON を正とする）。各操作は 1 コミットで、EN/KO の CSV と JSON は
 * その後 Sync JSON Data が作り直す。akyoData を渡すと、選んだカテゴリを Akyo にまとめて
 * 付け外しするパネル（CategoryAssignPanel）も出る。
 */
export function CategoriesTab({
  userRole,
  onCategoriesChanged,
  akyoData,
  onPendingStateChange,
  blockedIds = EMPTY_IDS,
  onRowsCommitted,
  onCategoryRowsChanged,
  active = true,
}: CategoriesTabProps) {
  const isOwner = userRole === 'owner';
  // Bulk assignment: the AND set of categories, and whether the panel holds unsaved changes.
  // While changes are held, renaming and merging and deleting are locked: the held rows still
  // carry the old names and the batch API would reject them as conflicts. Creating a category
  // and registering a translation change no token, so they stay available.
  const [selected, setSelected] = useState<string[]>([]);
  const [assignState, setAssignState] = useState({ pending: false, busy: false });
  const handleAssignState = useCallback(
    (pending: boolean, assignBusy: boolean, ids?: string[]) => {
      setAssignState({ pending, busy: assignBusy });
      onPendingStateChange?.(pending, assignBusy, ids);
    },
    [onPendingStateChange],
  );
  const locked = assignState.pending || assignState.busy;
  // A commit clears the hold, so keep the panel on screen while its result is worth reading
  // (the selection may already be empty, which would otherwise hide the message at once).
  const [assignMessageShown, setAssignMessageShown] = useState(false);
  const handleClearSelection = useCallback(() => {
    setSelected([]);
    setAssignMessageShown(false);
  }, []);
  const handleAssignCommitted = useCallback(
    (rows: AkyoData[], originals: AkyoEditFields[]) => {
      onRowsCommitted?.(rows, originals);
      setAssignMessageShown(true);
      // main moved: the list counts and `head` are now older than the branch.
      void load();
    },
    // `load` is defined below with an empty dependency list, so this stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onRowsCommitted],
  );
  const [entries, setEntries] = useState<CategoryEntry[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  // Commit the list was read from. Sent with every change so the server refuses an edit
  // decided on a screen that no longer matches main (409 → reload).
  const [head, setHead] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState({ ja: '', en: '', ko: '', into: '' });
  // 一緒に作る上の階層の対訳。キーは完全なパスなので、名前を打ち直しても入力は残る
  const [levelNames, setLevelNames] = useState<Record<string, { en: string; ko: string }>>({});
  const setLevelName = (path: string, patch: Partial<{ en: string; ko: string }>) => {
    setLevelNames((previous) => ({
      ...previous,
      [path]: { ...(previous[path] ?? { en: '', ko: '' }), ...patch },
    }));
  };
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/categories');
      const data = (await response.json()) as CategoryListResponse;
      if (!response.ok || !data.success || !data.categories) {
        throw new Error(data.error || 'カテゴリ一覧を取得できませんでした');
      }
      const categories = data.categories;
      setEntries(categories);
      setColors(data.colors ?? {});
      setHead(data.head ?? '');
      // The AND set follows the list: a renamed, merged or deleted category (by us or by
      // another admin) must not stay selectable, or a card click would write the old name back.
      setSelected((previous) => previous.filter((path) => categories.some((entry) => entry.path === path)));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'カテゴリ一覧を取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  // The tab stays mounted so held changes survive a tab switch, so it no longer refetches by
  // remounting: reload whenever it becomes visible again. `head` and the list would otherwise
  // be older than main after any commit made from another tab, and every edit would 409.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) void load();
    wasActive.current = active;
  }, [active, load]);

  const entriesByPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(needle) ||
        (entry.en ?? '').toLowerCase().includes(needle) ||
        (entry.ko ?? '').toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const openEditor = (opened: EditorTarget) => {
    const next: Editor = { ...opened, head };
    setFormError('');
    setMessage('');
    setCommitUrl('');
    if (next.kind === 'rename') {
      const entry = entriesByPath.get(next.path);
      setForm({
        ja: next.path,
        en: entry?.en ? leafOf(entry.en) : '',
        ko: entry?.ko ? leafOf(entry.ko) : '',
        into: '',
      });
    } else {
      setForm({ ja: '', en: '', ko: '', into: '' });
    }
    setLevelNames({});
    setEditor(next);
  };

  const closeEditor = () => {
    setEditor(null);
    setFormError('');
  };

  const submit = async (body: Record<string, unknown>, baseHead: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setFormError('');
    setMessage('');
    setCommitUrl('');
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, head: baseHead }),
      });
      const data = (await response.json()) as CategoryMutationResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'カテゴリの更新に失敗しました');
      }
      // A rename, merge or delete rewrote Akyo rows: hand the new cells to the shared catalog
      // so the cards and the next held change use the post-change categories.
      if (data.updatedRows?.length) onCategoryRowsChanged?.(data.updatedRows);
      setMessage(data.message || '更新しました');
      setCommitUrl(data.commitUrl || '');
      setEditor(null);
      await load();
      onCategoriesChanged?.();
      return true;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'カテゴリの更新に失敗しました');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleSubmitEditor = async () => {
    if (!editor) return;
    // A form opened before the hold began must not slip past the lock on the list buttons.
    if (locked && changesCategoryTokens(editor, form.ja)) {
      setFormError(LOCKED_TITLE);
      return;
    }
    if (editor.kind === 'create') {
      const leaf = form.ja.trim();
      const path = editor.parent ? `${editor.parent}/${leaf}` : leaf;
      const ancestors = planCategoryCreateLevels(path, entries.map((entry) => entry.path))
        .filter((level) => !level.exists && level.path !== path)
        .map((level) => ({
          path: level.path,
          en: (levelNames[level.path]?.en ?? '').trim(),
          ko: (levelNames[level.path]?.ko ?? '').trim(),
        }));
      await submit(
        { action: 'create', path, en: form.en.trim(), ko: form.ko.trim(), ancestors },
        editor.head,
      );
      return;
    }
    if (editor.kind === 'rename') {
      const to = form.ja.trim();
      const en = form.en.trim();
      const ko = form.ko.trim();
      // Unchanged Japanese name = translation only. That action is open to admins,
      // renaming is not, so the two must not share a request.
      if (to === editor.path) {
        await submit({ action: 'translate', path: editor.path, en, ko }, editor.head);
      } else {
        await submit({ action: 'rename', from: editor.path, to, en, ko }, editor.head);
      }
      return;
    }
    const into = form.into;
    if (!into) {
      setFormError('統合先を選んでください');
      return;
    }
    const source = entriesByPath.get(editor.path);
    const confirmed = confirm(
      `「${editor.path}」を「${into}」に統合します。\n\n` +
        `対象: ${source?.count ?? 0} 件の Akyo\n` +
        `「${editor.path}」とその配下は「${into}」の配下に付け替えられ、元のカテゴリは無くなります。\n\n` +
        'この操作は取り消せません。実行しますか？',
    );
    if (!confirmed) return;
    await submit({ action: 'merge', from: editor.path, into }, editor.head);
  };

  const handleDelete = async (entry: CategoryEntry) => {
    setFormError('');
    if (locked) {
      setFormError(LOCKED_TITLE);
      return;
    }
    const confirmed = confirm(
      `カテゴリ「${entry.path}」を削除します。\n\n` +
        `${entry.count} 件の Akyo から「${entry.path}」とその配下のカテゴリが外れます。\n` +
        '対訳も削除されます。\n\n' +
        'この操作は取り消せません。実行しますか？',
    );
    if (!confirmed) return;
    setEditor(null);
    // No form here: the confirm text came from the list on screen, so its head is the base.
    await submit({ action: 'delete', path: entry.path }, head);
  };

  const mergeTargets = (path: string) =>
    entries.filter((entry) => !isSelfOrDescendant(entry.path, path) && !isSelfOrDescendant(path, entry.path));

  const renderEditor = (context: EditorTarget) => {
    if (!editor) return null;
    const matches =
      editor.kind === context.kind &&
      (context.kind === 'create'
        ? editor.kind === 'create' && editor.parent === context.parent
        : editor.kind !== 'create' && editor.path === context.path);
    if (!matches) return null;
    const title =
      editor.kind === 'create'
        ? editor.parent
          ? `「${editor.parent}」の下にカテゴリを追加`
          : '最上位カテゴリを追加'
        : editor.kind === 'rename'
          ? isOwner
            ? `「${editor.path}」の名前と対訳`
            : `「${editor.path}」の対訳`
          : `「${editor.path}」を別のカテゴリに統合`;
    const idBase = `category-editor-${editor.kind}`;
    // 入力中のパスを階層に分け、まだ無い上の階層は対訳も一緒に訊く。
    // これが無いと「新しい親/新しい子」を一度に作れない
    const typedPath =
      editor.kind === 'create' && editor.parent
        ? `${editor.parent}/${form.ja.trim()}`
        : form.ja.trim();
    const newAncestors =
      editor.kind === 'create'
        ? planCategoryCreateLevels(typedPath, entries.map((entry) => entry.path)).filter(
            (level) => !level.exists && level.path !== typedPath,
          )
        : [];
    const leafLabel = typedPath.split('/').filter(Boolean).at(-1) ?? '';
    return (
      <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-4 space-y-3" role="group" aria-label={title}>
        <p className="text-sm font-semibold text-green-900">{title}</p>
        {editor.kind !== 'merge' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${idBase}-ja`} className="block text-sm font-medium text-green-900 mb-1">
                {editor.kind === 'create'
                  ? 'カテゴリ名（日本語）'
                  : isOwner
                    ? 'カテゴリ名（日本語、「/」で階層を変えると移動）'
                    : 'カテゴリ名（日本語の変更はらどのみ）'}
              </label>
              <div className="flex items-center gap-1">
                {editor.kind === 'create' && editor.parent && (
                  <span className="shrink-0 text-sm text-green-800">{editor.parent}/</span>
                )}
                <input
                  id={`${idBase}-ja`}
                  type="text"
                  value={form.ja}
                  disabled={busy || (editor.kind === 'rename' && !isOwner)}
                  onChange={(event) => setForm((previous) => ({ ...previous, ja: event.target.value }))}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder={editor.kind === 'create' ? '例: ねこ' : ''}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${idBase}-en`} className="block text-sm font-medium text-green-900 mb-1">
                {leafLabel ? `英語名（「${leafLabel}」の分だけ）` : '英語名（末尾の階層の分だけ）'}
              </label>
              <input
                id={`${idBase}-en`}
                type="text"
                value={form.en}
                disabled={busy}
                onChange={(event) => setForm((previous) => ({ ...previous, en: event.target.value }))}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                placeholder="例: Cat"
              />
            </div>
            <div>
              <label htmlFor={`${idBase}-ko`} className="block text-sm font-medium text-green-900 mb-1">
                {leafLabel ? `韓国語名（「${leafLabel}」の分だけ）` : '韓国語名（末尾の階層の分だけ）'}
              </label>
              <input
                id={`${idBase}-ko`}
                type="text"
                value={form.ko}
                disabled={busy}
                onChange={(event) => setForm((previous) => ({ ...previous, ko: event.target.value }))}
                className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                placeholder="例: 고양이"
              />
            </div>
          </div>
        )}
        {newAncestors.map((level) => (
          <div key={level.path} className="rounded-lg border border-green-200 bg-white/70 p-3">
            <p className="mb-2 text-sm font-medium text-green-900">
              「{level.segment}」の名前
              <span className="ml-2 text-xs font-normal text-green-800">
                新しく作る階層（{level.path}）
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${idBase}-en-${level.path}`} className="block text-sm font-medium text-green-900 mb-1">
                  英語名
                </label>
                <input
                  id={`${idBase}-en-${level.path}`}
                  type="text"
                  value={levelNames[level.path]?.en ?? ''}
                  disabled={busy}
                  onChange={(event) => setLevelName(level.path, { en: event.target.value })}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder="例: Cat"
                />
              </div>
              <div>
                <label htmlFor={`${idBase}-ko-${level.path}`} className="block text-sm font-medium text-green-900 mb-1">
                  韓国語名
                </label>
                <input
                  id={`${idBase}-ko-${level.path}`}
                  type="text"
                  value={levelNames[level.path]?.ko ?? ''}
                  disabled={busy}
                  onChange={(event) => setLevelName(level.path, { ko: event.target.value })}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder="例: 고양이"
                />
              </div>
            </div>
          </div>
        ))}
        {editor.kind === 'merge' && (
          <div>
            <label htmlFor={`${idBase}-into`} className="block text-sm font-medium text-green-900 mb-1">
              統合先
            </label>
            <select
              id={`${idBase}-into`}
              value={form.into}
              disabled={busy}
              onChange={(event) => setForm((previous) => ({ ...previous, into: event.target.value }))}
              className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
            >
              <option value="">選んでください</option>
              {mergeTargets(editor.path).map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.path}（{entry.count} 件）
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-green-800">
          親の英語名・韓国語名は自動で前に付きます。決定すると GitHub に 1 コミットされ、英語・韓国語のデータは自動で追従します。
        </p>
        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeEditor}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSubmitEditor()}
            disabled={busy || (locked && changesCategoryTokens(editor, form.ja))}
            title={locked && changesCategoryTokens(editor, form.ja) ? LOCKED_TITLE : undefined}
            className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
          >
            {busy ? '反映中…' : editor.kind === 'create' ? '作成する' : editor.kind === 'rename' ? '決定' : '統合する'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-800">
          <IconTags size="w-5 h-5" className="text-red-500 mr-2" /> カテゴリを管理
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          aria-label="最新のカテゴリを再取得"
          title="最新のカテゴリを再取得"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <IconRedo size="w-5 h-5" className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="mb-4 text-sm text-gray-600">
        階層ごとに名前と対訳を変えられます。親を改名すると配下も一緒に変わり、親を削除すると配下も外れます。
        {akyoData && ' 行の「選択」でカテゴリを選ぶと、Akyo にまとめて付け外しできます。'}
      </p>

      {message && (
        <p role="status" className="mb-4 text-sm text-green-800">
          ✅ {message}
          {commitUrl && (
            <>
              {' '}
              <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="underline">
                コミットを見る
              </a>
            </>
          )}
        </p>
      )}
      {formError && !editor && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {formError}
        </p>
      )}

      {/* Always mounted: held changes and saved results must survive changing or clearing the selection. */}
      {akyoData && (
        <CategoryAssignPanel
          akyoData={akyoData}
          selected={selected}
          visible={selected.length > 0 || assignState.pending || assignMessageShown}
          blockedIds={blockedIds}
          onClearSelection={handleClearSelection}
          onPendingStateChange={handleAssignState}
          onCommitted={handleAssignCommitted}
        />
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="categories-tab-search" className="sr-only">
            カテゴリを検索
          </label>
          <SearchBar
            id="categories-tab-search"
            value={query}
            onSearch={setQuery}
            placeholder="カテゴリ名、英語名、韓国語名で検索"
            ariaLabel="カテゴリを検索"
            disabled={loading}
          />
        </div>
        <button
          type="button"
          onClick={() => openEditor({ kind: 'create', parent: null })}
          disabled={loading || busy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-green-300 bg-green-100 text-green-800 hover:bg-green-200 transition-colors disabled:opacity-50"
        >
          <IconPlusCircle size="w-4 h-4" />
          最上位カテゴリを追加
        </button>
      </div>
      {renderEditor({ kind: 'create', parent: null })}

      <div className="mt-4 mb-2 text-sm text-gray-600">
        全{entries.length}件中 {visibleEntries.length}件を表示
      </div>

      {loadError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {loadError}
        </p>
      )}

      <div className="border border-gray-200 rounded-lg">
        {loading && entries.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">読み込み中…</p>
        ) : visibleEntries.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">一致するカテゴリがありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visibleEntries.map((entry) => {
              const depth = depthOf(entry.path);
              const topLevel = entry.path.split('/', 1)[0];
              const color = colors[topLevel];
              const untranslated = entry.en === null || entry.ko === null;
              return (
                <li key={entry.path} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ paddingLeft: `${depth * 1.5}rem` }}>
                    {depth === 0 && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ background: color ?? '#9ca3af' }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-800 break-words">
                        {depth > 0 && <span className="text-gray-400">{parentOf(entry.path)}/</span>}
                        {leafOf(entry.path)}
                        <span className="ml-2 text-xs font-normal text-gray-500">{entry.count} 件</span>
                      </div>
                      <div className="text-xs text-gray-500 break-words">
                        {untranslated ? (
                          <span className="text-amber-700">対訳なし（英語・韓国語のデータに反映されません）</span>
                        ) : (
                          <>
                            {entry.en} <span className="text-gray-300">|</span> {entry.ko}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {akyoData && isProtectedCategoryPath(entry.path) && (
                        <span className="px-3 py-1.5 text-xs text-gray-500" title={PROTECTED_TITLE}>
                          自動付与
                        </span>
                      )}
                      {/* Booth and the world marker are written by the app itself: the server
                          re-adds them, so offering them here would only look like a change. */}
                      {akyoData && !isProtectedCategoryPath(entry.path) && (
                        <button
                          type="button"
                          aria-pressed={selected.includes(entry.path)}
                          aria-label={`${entry.path} を付け外しの対象に${selected.includes(entry.path) ? 'しない' : 'する'}`}
                          disabled={busy || assignState.busy}
                          onClick={() => {
                            setAssignMessageShown(false);
                            setSelected((previous) =>
                              previous.includes(entry.path)
                                ? previous.filter((path) => path !== entry.path)
                                : [...previous, entry.path],
                            );
                          }}
                          className={`px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                            selected.includes(entry.path)
                              ? 'border-green-500 bg-green-100 text-green-900 font-semibold'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {selected.includes(entry.path) ? '✓ 選択中' : '選択'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditor({ kind: 'create', parent: entry.path })}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        子を追加
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditor({ kind: 'rename', path: entry.path })}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        {untranslated ? '対訳を登録' : isOwner ? '改名・対訳' : '対訳'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditor({ kind: 'merge', path: entry.path })}
                        disabled={busy || !isOwner || locked}
                        title={!isOwner ? OWNER_ONLY_TITLE : locked ? LOCKED_TITLE : undefined}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        統合
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        disabled={busy || !isOwner || locked}
                        title={!isOwner ? OWNER_ONLY_TITLE : locked ? LOCKED_TITLE : undefined}
                        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  {renderEditor({ kind: 'create', parent: entry.path })}
                  {renderEditor({ kind: 'rename', path: entry.path })}
                  {renderEditor({ kind: 'merge', path: entry.path })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
