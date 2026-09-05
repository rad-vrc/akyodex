'use client';

import { IconPlusCircle, IconRedo, IconTags } from '@/components/icons';
import { SearchBar } from '@/components/search-bar';
import type { AdminRole } from '@/types/akyo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface CategoriesTabProps {
  userRole: AdminRole;
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
}

type Editor =
  | { kind: 'create'; parent: string | null }
  | { kind: 'rename'; path: string }
  | { kind: 'merge'; path: string };

const OWNER_ONLY_TITLE = '改名・統合・削除はらど（上位管理者）のみ使用できます';

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

function isSelfOrDescendant(token: string, path: string): boolean {
  return token === path || token.startsWith(`${path}/`);
}

/**
 * Categories Tab
 * カテゴリタブ: 階層ごとの作成・改名（対訳の更新）・統合・削除。
 *
 * 一覧は /api/categories から毎回取り直す（管理画面の初期データは JSON 経由で遅れるため、
 * GitHub の CSV と対訳 JSON を正とする）。各操作は 1 コミットで、EN/KO の CSV と JSON は
 * その後 Sync JSON Data が作り直す。Akyo への付け外しは編集タブで行う。
 */
export function CategoriesTab({ userRole }: CategoriesTabProps) {
  const isOwner = userRole === 'owner';
  const [entries, setEntries] = useState<CategoryEntry[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState({ ja: '', en: '', ko: '', into: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [commitUrl, setCommitUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/categories');
      const data = (await response.json()) as CategoryListResponse;
      if (!response.ok || !data.success || !data.categories) {
        throw new Error(data.error || 'カテゴリ一覧を取得できませんでした');
      }
      setEntries(data.categories);
      setColors(data.colors ?? {});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'カテゴリ一覧を取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const openEditor = (next: Editor) => {
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
    setEditor(next);
  };

  const closeEditor = () => {
    setEditor(null);
    setFormError('');
  };

  const submit = async (body: Record<string, unknown>) => {
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
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as CategoryMutationResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'カテゴリの更新に失敗しました');
      }
      setMessage(data.message || '更新しました');
      setCommitUrl(data.commitUrl || '');
      setEditor(null);
      await load();
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
    if (editor.kind === 'create') {
      const leaf = form.ja.trim();
      const path = editor.parent ? `${editor.parent}/${leaf}` : leaf;
      await submit({ action: 'create', path, en: form.en.trim(), ko: form.ko.trim() });
      return;
    }
    if (editor.kind === 'rename') {
      const to = form.ja.trim();
      await submit({ action: 'rename', from: editor.path, to, en: form.en.trim(), ko: form.ko.trim() });
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
    await submit({ action: 'merge', from: editor.path, into });
  };

  const handleDelete = async (entry: CategoryEntry) => {
    setFormError('');
    const confirmed = confirm(
      `カテゴリ「${entry.path}」を削除します。\n\n` +
        `${entry.count} 件の Akyo から「${entry.path}」とその配下のカテゴリが外れます。\n` +
        '対訳も削除されます。\n\n' +
        'この操作は取り消せません。実行しますか？',
    );
    if (!confirmed) return;
    setEditor(null);
    await submit({ action: 'delete', path: entry.path });
  };

  const mergeTargets = (path: string) =>
    entries.filter((entry) => !isSelfOrDescendant(entry.path, path) && !isSelfOrDescendant(path, entry.path));

  const renderEditor = (context: Editor) => {
    if (!editor) return null;
    const matches =
      editor.kind === context.kind &&
      (editor.kind === 'create' ? editor.parent === (context as { parent: string | null }).parent : editor.path === (context as { path: string }).path);
    if (!matches) return null;
    const title =
      editor.kind === 'create'
        ? editor.parent
          ? `「${editor.parent}」の下にカテゴリを追加`
          : '最上位カテゴリを追加'
        : editor.kind === 'rename'
          ? `「${editor.path}」の名前と対訳`
          : `「${editor.path}」を別のカテゴリに統合`;
    const idBase = `category-editor-${editor.kind}`;
    return (
      <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-4 space-y-3" role="group" aria-label={title}>
        <p className="text-sm font-semibold text-green-900">{title}</p>
        {editor.kind !== 'merge' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${idBase}-ja`} className="block text-sm font-medium text-green-900 mb-1">
                {editor.kind === 'create' ? 'カテゴリ名（日本語）' : 'カテゴリ名（日本語、「/」で階層を変えると移動）'}
              </label>
              <div className="flex items-center gap-1">
                {editor.kind === 'create' && editor.parent && (
                  <span className="shrink-0 text-sm text-green-800">{editor.parent}/</span>
                )}
                <input
                  id={`${idBase}-ja`}
                  type="text"
                  value={form.ja}
                  disabled={busy}
                  onChange={(event) => setForm((previous) => ({ ...previous, ja: event.target.value }))}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                  placeholder={editor.kind === 'create' ? '例: ねこ' : ''}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${idBase}-en`} className="block text-sm font-medium text-green-900 mb-1">
                英語名（この階層の分だけ）
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
                韓国語名（この階層の分だけ）
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
            disabled={busy}
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
        階層ごとに名前と対訳を変えられます。親を改名すると配下も一緒に変わり、親を削除すると配下も外れます。Akyo への付け外しは編集タブで行います。
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
                        disabled={busy || (!isOwner && !untranslated)}
                        title={!isOwner && !untranslated ? OWNER_ONLY_TITLE : undefined}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        {untranslated ? '対訳を登録' : '改名・対訳'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditor({ kind: 'merge', path: entry.path })}
                        disabled={busy || !isOwner}
                        title={!isOwner ? OWNER_ONLY_TITLE : undefined}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        統合
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        disabled={busy || !isOwner}
                        title={!isOwner ? OWNER_ONLY_TITLE : undefined}
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
