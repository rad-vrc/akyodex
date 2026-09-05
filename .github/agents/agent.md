---
name: Akyo
description: 'Akyodex coding agent: Next.js 16 + TypeScript + Cloudflare Pages/R2/KV. VRChat avatar & world encyclopedia with 800+ entries, HMAC auth, Sentry observability, multi-tier data loading.'
tools:
  [
    'vscode/extensions',
    'vscode/getProjectSetupInfo',
    'vscode/installExtension',
    'vscode/newWorkspace',
    'vscode/openSimpleBrowser',
    'vscode/runCommand',
    'vscode/askQuestions',
    'vscode/switchAgent',
    'vscode/vscodeAPI',
    'execute/getTerminalOutput',
    'execute/awaitTerminal',
    'execute/killTerminal',
    'execute/createAndRunTask',
    'execute/runInTerminal',
    'execute/runNotebookCell',
    'execute/testFailure',
    'read/terminalSelection',
    'read/terminalLastCommand',
    'read/getNotebookSummary',
    'read/problems',
    'read/readFile',
    'agent/runSubagent',
    'firecrawl/FIRECRAWL_CANCEL_A_CRAWL_JOB',
    'firecrawl/FIRECRAWL_CRAWL_V2',
    'firecrawl/FIRECRAWL_EXTRACT',
    'firecrawl/FIRECRAWL_GET_THE_STATUS_OF_A_CRAWL_JOB',
    'firecrawl/FIRECRAWL_MAP_MULTIPLE_URLS_BASED_ON_OPTIONS',
    'firecrawl/FIRECRAWL_SCRAPE',
    'firecrawl/FIRECRAWL_SEARCH',
    'chrome-devtools/click',
    'chrome-devtools/close_page',
    'chrome-devtools/drag',
    'chrome-devtools/emulate',
    'chrome-devtools/evaluate_script',
    'chrome-devtools/fill',
    'chrome-devtools/fill_form',
    'chrome-devtools/get_console_message',
    'chrome-devtools/get_network_request',
    'chrome-devtools/handle_dialog',
    'chrome-devtools/hover',
    'chrome-devtools/list_console_messages',
    'chrome-devtools/list_network_requests',
    'chrome-devtools/list_pages',
    'chrome-devtools/navigate_page',
    'chrome-devtools/new_page',
    'chrome-devtools/performance_analyze_insight',
    'chrome-devtools/performance_start_trace',
    'chrome-devtools/performance_stop_trace',
    'chrome-devtools/press_key',
    'chrome-devtools/resize_page',
    'chrome-devtools/select_page',
    'chrome-devtools/take_screenshot',
    'chrome-devtools/take_snapshot',
    'chrome-devtools/upload_file',
    'chrome-devtools/wait_for',
    'cloudflare-autorag/search',
    'cloudflare-docs/migrate_pages_to_workers_guide',
    'cloudflare-docs/search_cloudflare_documentation',
    'context7/get-library-docs',
    'context7/resolve-library-id',
    'edit/createDirectory',
    'edit/createFile',
    'edit/createJupyterNotebook',
    'edit/editFiles',
    'edit/editNotebook',
    'search/changes',
    'search/codebase',
    'search/fileSearch',
    'search/listDirectory',
    'search/searchResults',
    'search/textSearch',
    'search/usages',
    'search/searchSubagent',
    'web/fetch',
    'github/add_comment_to_pending_review',
    'github/add_issue_comment',
    'github/assign_copilot_to_issue',
    'github/create_branch',
    'github/create_or_update_file',
    'github/create_pull_request',
    'github/create_repository',
    'github/delete_file',
    'github/fork_repository',
    'github/get_commit',
    'github/get_file_contents',
    'github/get_label',
    'github/get_latest_release',
    'github/get_me',
    'github/get_release_by_tag',
    'github/get_tag',
    'github/get_team_members',
    'github/get_teams',
    'github/issue_read',
    'github/issue_write',
    'github/list_branches',
    'github/list_commits',
    'github/list_issue_types',
    'github/list_issues',
    'github/list_pull_requests',
    'github/list_releases',
    'github/list_tags',
    'github/merge_pull_request',
    'github/pull_request_read',
    'github/pull_request_review_write',
    'github/push_files',
    'github/request_copilot_review',
    'github/search_code',
    'github/search_issues',
    'github/search_pull_requests',
    'github/search_repositories',
    'github/search_users',
    'github/sub_issue_write',
    'github/update_pull_request',
    'github/update_pull_request_branch',
    'todo',
    'memory',
  ]
---

# Akyodex コーディングエージェント

VRChat アバター・ワールド図鑑「Akyodex」の開発エージェント。800体以上のエントリ（アバター＋ワールド）を4桁ID (0001-) で管理する Next.js アプリケーション。日本語/英語/韓国語の多言語対応。

## 技術スタック

- **Framework**: Next.js 16.1.6 (App Router) + React 19.2.4
- **Language**: TypeScript 5.9.3 (strict mode)
- **Runtime**: Cloudflare Pages (Edge + Node.js) + @opennextjs/cloudflare ^1.16.5
- **Storage**: Cloudflare R2 (画像・CSV・JSON), Cloudflare KV (セッション・データキャッシュ)
- **Styling**: Tailwind CSS 4 (PostCSS plugin)
- **Auth**: HMAC署名セッション (Web Crypto API) + HTTP-only Cookie (24h expiry)
- **Observability**: Sentry (@sentry/nextjs ^10.39.0) — エラー追跡・パフォーマンス監視
- **Sanitization**: sanitize-html ^2.17.0
- **CSV**: csv-parse / csv-stringify
- **Data Sync**: GitHub API (CRUD時にCSVをGitHubへコミット)
- **Testing**: Playwright (E2E), node:test + assert (ユニットテスト), Knip (dead code analysis)
- **Linting**: ESLint 9 + Next.js config
- **Node**: 20.x, npm 10.x

## エントリ種別

Akyodex は **アバター** と **ワールド** の2種類のエントリを管理する。

- **avatar**: VRChat アバター。`avtr_` で始まる URL を持つ
- **world**: VRChat ワールド。`wrld_` で始まる URL を持ち、カテゴリに「ワールド」「world」「월드」を含む
- エントリ種別は CSV の `EntryType` 列で明示指定。未指定時はカテゴリから自動補完（`akyo-entry.ts` の `hydrateAkyoDataset`）
- 表示IDは種別ごとに `Avatar` / `World` プレフィックス付き（例: `#Avatar0746`, `#World0003`）
- `displaySerial` で種別内の連番を管理。未指定時のフォールバックは種別ごとに異なり、avatar エントリは `id` を使用し、world エントリは `hydrateAkyoDataset()` で未使用の連番が自動採番される

## データアーキテクチャ

データソース優先順位: **KV (~5ms) → JSON (~20ms) → CSV (~200ms)**

- `data/akyo-data-ja.csv` / `data/akyo-data-ja.json` — 日本語データ
- `data/akyo-data-en.csv` / `data/akyo-data-en.json` — 英語データ
- `data/akyo-data-ko.csv` / `data/akyo-data-ko.json` — 韓国語データ
- CRUD操作時: R2更新 → KVキャッシュ更新 → GitHub CSV同期 → ISR revalidation

### CSV スキーマ（10列）

| 列名 | 必須 | 説明 |
|---|---|---|
| `ID` | ✅ | 4桁のID番号 (例: "0001") |
| `Nickname` | ✅ | 通称 |
| `AvatarName` | ✅ | アバター名 |
| `Category` | ✅ | カテゴリ（カンマ区切り、階層は `/` 区切り） |
| `Comment` | | 備考 |
| `Author` | ✅ | 作者名 |
| `AvatarURL` | | VRChat URL（旧互換） |
| `SourceURL` | | エントリの元URL（avatar/world共通） |
| `EntryType` | | `avatar` または `world`（未指定時はカテゴリから推定） |
| `DisplaySerial` | | 種別内の表示用連番 |

### 統合データモジュール

`src/lib/akyo-data.ts` がエントリーポイント。データ読み込みは階層化されている：

- `akyo-data-kv.ts` — KV キャッシュからの読み込み
- `akyo-data-json.ts` — JSON ファイルからの読み込み
- `akyo-data-server.ts` — サーバーサイド専用の読み込み
- `akyo-entry.ts` — エントリの正規化・種別推定 (`hydrateAkyoDataset`)

## ビルド・検証コマンド

```bash
npm install              # 依存関係インストール
npm run dev              # 開発サーバー (Turbopack, localhost:3000)
npm run build            # Cloudflare Pages ビルド (OpenNext + prepare script)
npm run next:build       # Next.js ビルドのみ
npm run lint             # ESLint
npm run knip             # Dead code analysis
npm run test             # Playwright E2E テスト
npm run data:convert     # CSV → JSON 変換 (npx tsx scripts/csv-to-json.ts)
npm run test:csv         # CSV データ品質チェック
npm run generate-ko-data # 韓国語データ生成
```

### ユニットテスト

ユニットテストは Node.js 組み込みの `node:test` + `assert` を使用：

```bash
node --import tsx --test src/lib/akyo-entry.test.ts
node --import tsx --test src/lib/csv-utils.test.ts
```

## ディレクトリ構造

```
Akyodex/                            # リポジトリルート (monorepoではない)
├── src/
│   ├── app/                        # App Router
│   │   ├── admin/                  # 管理画面
│   │   ├── zukan/                  # 図鑑 (SSG + ISR)
│   │   ├── offline/                # オフラインページ
│   │   └── api/                    # API Routes
│   │       ├── admin/              # login, logout, verify-session, next-id
│   │       ├── akyo-data/          # データ取得 API (Node.js runtime)
│   │       ├── avatar-image/       # アバター画像プロキシ (R2 → VRChat ページ/API フォールバック → Placeholder)
│   │       ├── check-duplicate/    # 重複チェック
│   │       ├── csv/                # CSV データ取得
│   │       ├── delete-akyo/        # 削除
│   │       ├── categories/         # カテゴリの一覧・作成・改名・統合・削除（1 コミット）
│   │       ├── download-reference/ # 三面図ダウンロード (R2)
│   │       ├── kv-migrate/         # KVデータ移行
│   │       ├── manifest/           # PWA マニフェスト
│   │       ├── revalidate/         # On-demand ISR
│   │       ├── update-akyo/        # 更新
│   │       ├── upload-akyo/        # 新規登録
│   │       ├── vrc-avatar-image/   # VRChat アバター画像取得
│   │       ├── vrc-avatar-info/    # VRChat アバター情報取得
│   │       ├── vrc-world-image/    # VRChat ワールド画像取得 (Node.js runtime)
│   │       └── vrc-world-info/     # VRChat ワールド情報取得 (Node.js runtime)
│   ├── components/                 # UI コンポーネント
│   │   └── admin/                  # 管理画面用
│   ├── hooks/                      # カスタムフック (use-akyo-data, use-language)
│   ├── lib/                        # ユーティリティ
│   │   ├── api-helpers.ts          # jsonError, jsonSuccess, getApiErrorResponse, setSessionCookie, ensureAdminRequest, validateOrigin
│   │   ├── akyo-data.ts            # 統合データモジュール (KV→JSON→CSV)
│   │   ├── akyo-data-helpers.ts    # 共通ヘルパー (extractCategories, extractAuthors, findAkyoById)
│   │   ├── akyo-data-json.ts       # JSON データ読み込み
│   │   ├── akyo-data-kv.ts         # KV キャッシュ読み込み
│   │   ├── akyo-data-server.ts     # サーバーサイドデータ読み込み
│   │   ├── akyo-crud-helpers.ts    # CRUD操作ヘルパー
│   │   ├── akyo-entry.ts           # エントリ正規化・種別推定 (hydrateAkyoDataset)
│   │   ├── blur-data-url.ts        # ブラー画像生成 (generateBlurDataURL)
│   │   ├── cloudflare-image-loader.ts # Cloudflare Images カスタムローダー
│   │   ├── csv-utils.ts            # CSV parse/stringify + GitHub同期
│   │   ├── github-utils.ts         # GitHub API操作
│   │   ├── html-utils.ts           # XSS対策 (stripHTMLTags, decodeHTMLEntities)
│   │   ├── i18n.ts                 # 多言語ユーティリティ
│   │   ├── next-id-state.ts        # 次ID採番の状態管理
│   │   ├── r2-utils.ts             # R2ストレージ操作
│   │   ├── sentry-browser.ts       # Sentry ブラウザ設定
│   │   ├── session.ts              # HMAC セッション管理 (Web Crypto API)
│   │   ├── vrchat-utils.ts         # VRChat アバター/ワールド ユーティリティ
│   │   ├── vrchat-world-image.ts   # VRChat ワールド画像取得
│   │   ├── vrchat-world-info.ts    # VRChat ワールド情報取得
│   │   └── world-registration.ts   # ワールド登録ヘルパー
│   ├── types/                      # 型定義
│   │   ├── akyo.ts                 # AkyoData, AkyoEntryType, AkyoFilterOptions
│   │   ├── kv.ts                   # KV 関連型
│   │   ├── env.d.ts                # 環境変数型
│   │   ├── cloudflare-workers.d.ts # Cloudflare Workers 型
│   │   ├── css.d.ts                # CSS モジュール型
│   │   └── sanitize-html.d.ts      # sanitize-html 型拡張
│   └── middleware.ts               # Edge middleware (i18n + CSP nonce)
├── instrumentation.ts              # Sentry サーバーサイド初期化
├── instrumentation-client.ts       # Sentry クライアントサイド初期化
├── scripts/                        # ユーティリティスクリプト (ESLint対象外, require()許可)
├── data/                           # CSV/JSON データ
└── public/                         # 静的ファイル (sw.js, images/)
```

## API ルート記述パターン

### 標準パターン（Edge Runtime）

Edge Runtime がデフォルト。明示的な `runtime` 宣言は不要：

```typescript
export async function POST(request: Request) {
  return Response.json({ success: true, data: result });
}
```

### Node.js Runtime が必要な場合

```typescript
export const runtime = 'nodejs';
// 理由: csv-parse/sync, GitHub API, Buffer による R2 バイナリ操作, VRChat ページスクレイピング
```

### ヘルパー関数の使用（必須）

```typescript
import {
  jsonError,
  jsonSuccess,
  getApiErrorResponse,
  setSessionCookie,
  clearSessionCookie,
  ensureAdminRequest,
} from '@/lib/api-helpers';

return jsonError('Invalid input', 400); // => { success: false, error: 'Invalid input' }
return jsonSuccess({ data }); // => { success: true, data }

// エラーハンドリング: error.message から HTTP ステータスを推定
return getApiErrorResponse(error, 'operation failed');

const result = await ensureAdminRequest(request, { requireOwner: true });
if ('response' in result) return result.response;
```

### 禁止パターン

```typescript
// ❌ NextRequest/NextResponse を不必要に使わない
import { NextRequest, NextResponse } from 'next/server';
// ❌ jsonError() を使わず直接エラーレスポンス
return Response.json({ error: 'msg' }, { status: 400 });
// ❌ Cookie を直接操作しない (setSessionCookie/clearSessionCookie を使う)
```

## コーディング規約

- `any` 型の使用禁止
- `require()` ではなく ES module (`import`) を使用（scripts/ 除く）
- ファイル末尾は改行1つで終わること
- PR は必ず別ブランチから作成し、main へ直接コミットしない
- 入力バリデーションは長さ制限付き正規表現（ReDoS 防止）
  - VRChat Avatar ID: `/^avtr_[A-Za-z0-9-]{1,64}$/`
  - VRChat World ID: `/^wrld_[A-Za-z0-9-]{1,64}$/`
- パスワード比較は constant-time Uint8Array 比較を使用
- HTML 出力は `sanitize-html` でサニタイズ
- セッションは HMAC 署名 (Web Crypto API)、JWT は使用しない
- `main` 取り込み後の EN/KO 翻訳再生成タスクは `akyodex-main-translation-sync` skill の手順を優先して実行する

## Cloudflare バインディング

- `AKYO_BUCKET` (R2) — 画像 + データファイル
- `AKYO_KV` (KV) — セッション + データキャッシュ
- `NEXT_TAG_CACHE_KV` (KV) — OpenNext タグキャッシュ（`AKYO_KV` と同一 namespace を共有）
- `NEXT_INC_CACHE_R2_BUCKET` (R2) — OpenNext インクリメンタルキャッシュ（`AKYO_BUCKET` と同一 bucket を共有）
- R2: 同名キーでアップロードすると上書きされる。削除→再アップは不要

## 安全基準

以下の変更は実行前にユーザーへの確認を必須とする：

- データスキーマ・外部 API 仕様の変更
- セキュリティ設定の変更
- 本番環境に影響する破壊的変更
- UI/UX デザインの変更
- 技術スタックのバージョン変更
- 個人情報/機微データの取り扱い方針変更

## 禁止事項

- 機能デグレード（エラー回避目的でのコメントアウト等）
- 未使用変数・未使用 export の放置
- `NEXT_PUBLIC_APP_URL` が未設定の状態での本番デプロイ
- `NextRequest`/`NextResponse` の不必要な使用
- JWT の使用（HMAC セッションに移行済）
- `any` 型の使用（型安全性を維持）
