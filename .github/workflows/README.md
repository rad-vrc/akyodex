# CI/CD Workflows Documentation

このドキュメントは `.github/workflows/*.yml` の現行実装を起点にした運用メモです。README と YAML が食い違う場合は、YAML を正として扱ってください。

## 📚 関連ドキュメント

このディレクトリには、以下の補助ドキュメントがあります。

| ドキュメント | 内容 |
| ------------ | ---- |
| `ARCHITECTURE.md` | ワークフロー全体の設計背景 |
| `QUICKSTART.md` | GitHub Actions / Cloudflare の初期セットアップ |
| `SUMMARY.md` | 導入時のサマリー |
| `NEXTDEVTOOLS-IMPROVEMENTS.md` | Next.js / CI 改善メモ |
| `WORKERS-VS-PAGES-ANALYSIS.md` | Workers と Pages の比較検討 |

## ワークフロー概要

| ワークフロー | ファイル | トリガー | 主な役割 | 補足 |
| ------------- | --------- | --------- | --------- | ---- |
| CI | `ci.yml` | PR / push (`main`, `develop`) | 型チェック、Cloudflare Pages ビルド検証、Security Scan | ESLint と Dify CSP hash は advisory |
| Deploy Workers staging | `deploy-cloudflare-workers-staging.yml` | non-draft PR (`main`) | 最新PRを本番相当の共有Workers環境へデプロイ | `X-Akyodex-Worker-Tag`でSHAを照合 |
| Deploy Workers production | `deploy-cloudflare-workers-production.yml` | `main` push / manual | 本番候補のupload、手動activate、Pagesへのrollback | `main` pushだけでは本番routeを変更しない |
| Deploy Pages PR Preview | `deploy-cloudflare-pages-preview.yml` | non-draft same-repository PR (`main`) | PRごとの独立した読み取り専用Previewを作成 | Dependabotとfork PRは対象外 |
| Verify Pages rollback | `cloudflare-pages-preview-gate.yml` | non-draft PR (`main`) / manual | 固定したPagesロールバック先の健全性確認 | Previewの作成は行わない |
| Deploy Pages rollback | `deploy-cloudflare-pages.yml` | `pages-rollback`からmanual | 既知の正常なPages版を手動再デプロイ | `main`からは実行不可 |
| Conflict Check | `conflict-check.yml` | PR to `main`, push to `main` | `main` との競合をコメントで通知 | 競合解消時は古いコメントを削除 |
| Sync JSON Data from CSV | `sync-json-data.yml` | `main` push (CSV変更時) / manual | CSV→JSON 変換、R2 アップロード、ISR 再検証 | GitHub へ自動コミットも行う |
| Weekly Security Audit | `security-audit.yml` | weekly / manual | `npm audit`、Snyk、CodeQL、Issue 作成 | Snyk は token がある場合のみ有効 |
| Validate Cloudflare Resources | `validate-cloudflare-resources.yml` | daily / manual | R2/KV/CSV の健全性確認 | CSV チェックは legacy path 前提 |
| Next.js Health Check | `nextjs-health-check.yml` | PR (Next.js関連パス変更時) / manual | Next.js / Pages 互換性の advisory チェック | 警告中心で deploy の本線ではない |
| Lint project | `knip.yml` | PR / push (`main`, `cloudflare-opennext-test`) | `npm run knip` 実行 | dead-code / unused export 検知 |
| Claude Code Review | `claude-code-review.yml` | `@claude` メンション | Claude による issue / PR 補助 | 人手レビューの代替ではない |
| Reusable Build | `reusable-build.yml` | `workflow_call` | 再利用可能なビルド共通化 | 現在の本線 deploy/CI からは直接参照されていない |

### 推奨 Required Checks

Branch protection で最低限 Required にしたいのは次のチェックです。

- `CI - Continuous Integration / Build Validation`
- `Deploy Cloudflare Workers Staging / Deploy and verify Workers staging`
- `Deploy Cloudflare Pages PR Preview / Deploy and verify Pages PR preview`
- `Verify Cloudflare Pages Rollback / Verify Cloudflare Pages rollback`

`Conflict Check` は有用ですが、補助的なコメント通知として扱うのが実運用に合っています。

## 通常の開発フロー

1. ローカルで作業し、コミットする。
2. `git push` する。
3. PowerShell では repo 既定の wrapper が push 後に PR 状態を確認する。
4. それ以外の shell では `npm run push:check-pr -- -u origin HEAD` を使うと push と PR 状態確認をまとめて実行できる。
5. PR を開くと `CI`、共有Workers staging、PR別Pages Preview、Pages rollback確認が走る。
6. Pages Previewで表示を確認し、Workers固有機能は`staging.akyodex.com`で確認する。
7. `main`へのマージではPages本番を更新せず、Workers本番候補だけをuploadする。手動の`activate`を実行するまで`akyodex.com`はPagesのまま維持される。
8. CSV を更新したcommitが`main`に入ると`Sync JSON Data from CSV`が追加で走る。

## Cloudflare Pages PR Preview

**ファイル**: `deploy-cloudflare-pages-preview.yml`

### 何をしているか

- non-draftかつ同一リポジトリのPRだけを対象にし、forkとDependabotではSecretsを使用しません。
- 公開Previewは専用Pages project `akyodex-pr-preview`へデプロイし、Production/rollback用の`akyodex`から分離します。
- `npm run build`で`prepare-cloudflare-pages.js`まで実行し、Pages用`_worker.js`を生成します。
- `wrangler pages deploy --branch=pr-N --commit-hash=SHA`で明示的にPreviewへアップロードします。
- `pages deployment list --json`からbranchとSHAが一致するデプロイを探し、Cloudflare採番の不変URLを取得します。
- `/zukan`、完全カタログAPI、AVIFアバター画像、`noindex`、書き込み拒否を不変URLに対して検証します。
- PRコメントには不変URLと`pr-N`エイリアスの両方を掲載します。
- Cloudflare Freeの公式上限は月500 **builds** です。このworkflowはGitHub Actionsでビルドした成果物を直接アップロードするため、そのbuild枠を消費するかは公式資料だけでは確定できません。Usageを監視しつつ、同一PRへの追加pushごとに新しい不変デプロイが1件作成されることは前提にします。

`preview_deployment_setting=none`はGit連携の自動Preview buildを停止しますが、`wrangler pages deploy --branch=pr-N`による直接アップロードは利用できます。2026-08-27に実プロジェクトで、無効設定を変更せず2回連続で成功することを確認しています。

### 責務分担

- Pages Previewは画面、検索、フィルター、モーダル、公開読み取りAPIの独立レビュー用です。
- `akyodex-pr-preview`のProduction branchは実在しない`__unused__`で、`pr-N`は必ずPreview deploymentになります。
- `wrangler.toml`の`env.preview`は専用KV/R2へ接続し、本番データから分離します。
- `PAGES_PREVIEW_READ_ONLY=true`のWorker入口が`GET`/`HEAD`/`OPTIONS`以外をOpenNext到達前に`403`で拒否します。
- Preview応答には`X-Robots-Tag: noindex, nofollow, noarchive`を付与します。
- Pages Previewでは`/admin`へログインせず、書き込み、移行、アップロード、キャッシュ変更を行いません。HTTPガードとリソース分離に加えた運用上の第三防御です。
- Durable Object、Service Binding、Workers cache、`cf.image`、Workers Sentry、性能は共有`staging.akyodex.com`を正とします。
- Pages側のサーバーSentryは無効なので、Pages Previewの成功だけではサーバーエラー不在を保証しません。
- `akyodex.pages.dev`は`pages-rollback`に固定したロールバック先であり、PR Previewとは別です。

### 待機ポリシー

- デプロイメタデータは最大12回、5秒間隔で検索します。
- runtime healthも最大12回、5秒間隔で確認します。
- job全体のtimeoutは25分です。

### 成功時の見え方

- Step SummaryとPRコメントにdeployment ID、不変URL、PR aliasを出力します。
- PRへの追加pushでは同じ`pr-N`エイリアスが更新され、不変URLはコミットごとに残ります。

### 失敗時の見え方

- PRコメントを失敗状態へ更新し、Actions run URLを掲載します。

### Runbook

Pages PR Previewが失敗またはtimeoutしたら、次を上から順に確認してください。

1. `CLOUDFLARE_PAGES_PREVIEW_PROJECT` が実際の Pages project 名と一致しているか（既定値は`akyodex-pr-preview`）。
2. `preview_deployment_setting=none`は維持し、Actionsログで直接アップロード自体が成功しているか。
3. Cloudflare Pages側で`pr-N`と対象commitのPreview deploymentが作成されているか。
4. `npm run build`後に`.open-next/_worker.js`が生成されているか。
5. forkまたはDependabot PRではないか。該当する場合はskipが正常です。

## Deploy Workers Production

**ファイル**: `deploy-cloudflare-workers-production.yml`

### 安全境界

- `main`へのpushでは、SHA付きWorker versionをuploadするだけでトラフィックを切り替えません。
- 初回候補uploadがWorker未作成またはDurable Object migration未適用で失敗した場合だけ、Pagesが本番配信中であることを確認してから、`workers_dev=false`、Preview URL無効、routeなしの完全なWorkerを通常deployしてmigrationを適用します。その後、Pages配信を再確認して本物の候補versionをuploadします。
- 候補upload用configには本番routeを含めません。`akyodex.com/*`はroute専用configを使う手動`activate`だけが設定できます。
- Workers本番切替後にDurable Object migrationを追加した場合、この初回専用経路はPages確認で停止します。稼働中Workerへmigrationを適用する手順を別途レビューし、手動で実行してください。
- 本番切替は`workflow_dispatch`の`activate`を明示実行した場合だけです。
- `activate`は固定Pagesの健全性とWorker secretsを確認し、対象SHAを100%へdeployしてから最後に`akyodex.com/*` routeを付けます。
- runtime検証に失敗した場合、またはactivation jobがキャンセルされた場合はrouteを自動で外し、固定Pagesへ戻します。
- `rollback-pages`はWorker routeだけを外します。Pagesの再ビルドは不要です。
- routeの付け外しにはVersions運用向けの`wrangler triggers deploy`を使います。このコマンドはWrangler 4.126時点でexperimentalのため、手動activation、runtime検証、自動route解除を必須の防御として維持します。
- productionの`NEXT_TAG_CACHE_D1`は`akyodex-next-tag-cache-production`を使用し、stagingのタグ無効化が本番キャッシュへ波及しないよう分離します。

### 初回切替手順

1. `main`へのマージ後、`Upload production Worker candidate`が成功したことを確認する。
2. Cloudflare Worker `akyodex-workers-production`へ、`ADMIN_PASSWORD_OWNER`、`ADMIN_PASSWORD_ADMIN`、`GITHUB_TOKEN`をsecretとして設定する。管理者の運用を変えないため、管理者パスワードはPages本番と同じ値を使う。
3. Actionsから`Deploy Cloudflare Workers Production`を開き、`configure-secrets`を手動実行する。既存のActions `REVALIDATE_SECRET`とSentry DSNを値を表示せずWorkerへ転送し、`SESSION_SECRET`が未設定の場合だけ安全なランダム値を生成する。
4. `upload`を手動実行し、6つのsecretを保持した同じ`main`の候補versionを再作成する。secret設定用versionがdeployされても本番routeはまだ無いため、利用者の通信はPagesのままです。
5. `activate`を手動実行し、最新候補versionを有効化してから本番routeを付ける。
6. workflowのruntime検証に加え、管理画面ログイン、図鑑更新、リンク色、カテゴリ階層、3言語、Sentryを確認する。
7. 重大な不具合、データ件数不一致、または性能の明確な後退があれば、同workflowの`rollback-pages`を実行する。

### 本番Worker secrets

| 名前 | 用途 |
| ---- | ---- |
| `ADMIN_PASSWORD_OWNER` | 既存ownerログイン。Pages本番と同じ値を設定 |
| `ADMIN_PASSWORD_ADMIN` | 既存adminログイン。Pages本番と同じ値を設定 |
| `SESSION_SECRET` | session HMAC signing。`configure-secrets`が未設定時だけ生成し、既存値は保持 |
| `GITHUB_TOKEN` | 管理画面から`main`へ図鑑データを反映 |
| `REVALIDATE_SECRET` | データ更新後の再検証 |
| `SENTRY_DSN` | Workersサーバーエラー送信 |

管理者パスワードとGitHub tokenの値はGitHubやPagesから読み戻せないため、`activate`前にCloudflare Dashboardから設定してください。残る3件は`configure-secrets`が安全に設定し、値自体をリポジトリやActionsログへ出力しません。

## Deploy Pages Rollback

**ファイル**: `deploy-cloudflare-pages.yml`

### トリガー

- `pages-rollback`ブランチからの`workflow_dispatch`

`main`へのpushでは起動せず、`github.ref_name == 'pages-rollback'`のguardを満たさない手動実行もskipします。

### 実行フロー

1. Node.js 20 をセットアップし、npm cache と `.next/cache` を復元
2. `npm ci`
3. `npm run build`
4. `.open-next`、`_worker.js`、`_routes.json`、`_next/` の存在を検証
5. `cloudflare/wrangler-action@v3` で `pages deploy .open-next --project-name=${CF_PAGES_PROJECT} --branch=${CF_PAGES_PRODUCTION_BRANCH}`
6. deployment URL に対して HTTP ヘルスチェック
7. Step Summary に deploy 結果を記録

### ヘルスチェック仕様

- 対象: `steps.deployment.outputs.url`
- 成功条件: HTTP `200` / `301` / `302`
- リトライ: 10 回
- 間隔: 3 秒

### Step Summary の読み方

| 状態 | 意味 |
| ---- | ---- |
| `Deploy Step=success`, `Health Check=healthy` | deploy と URL 応答が両方成功 |
| `Deploy Step=success`, `Health Check=missing_url` | deploy 自体は成功したが action が URL を返さなかった |
| `Deploy Step=success`, `Health Check=unhealthy` | deploy 後の URL が想定 HTTP を返さなかった |
| `Deploy Step!=success` | Wrangler deploy そのものが失敗 |

### 実装上の注意点

- workflow は `CF_PAGES_PROJECT=${{ vars.CLOUDFLARE_PAGES_PROJECT || 'akyodex' }}` を使います。
- `CF_PAGES_PRODUCTION_BRANCH=${{ vars.CLOUDFLARE_PAGES_PRODUCTION_BRANCH || 'main' }}` を明示し、`pages-rollback`のチェックアウト名がPreview branchとして推測されないようにします。
- build step では `DEFAULT_ADMIN_PASSWORD_HASH` / `DEFAULT_OWNER_PASSWORD_HASH` / `DEFAULT_JWT_SECRET` 由来の legacy fallback をまだ export しています。
- ただし runtime code が読むのは `ADMIN_PASSWORD_OWNER`, `ADMIN_PASSWORD_ADMIN`, `SESSION_SECRET` です。workflow 側の legacy defaults は runtime source of truth ではありません。
- workflow ファイルには PR コメント step がありますが、現在の trigger は `push` と `workflow_dispatch` のみなので、その step は通常到達しません。

## CI とマージ安全性

### CI (`ci.yml`)

`ci.yml` は6つのjobで構成されています。

| Job | 役割 | Gating |
| --- | ---- | ------ |
| `lint-and-typecheck` | Dify CSP hash 検証、ESLint、TypeScript | TypeScript は hard fail、Dify hash と ESLint は `continue-on-error` |
| `build-validation` | Cloudflare Pages build と成果物検証 | Required check 候補 |
| `workers-build-validation` | 本番Workers設定のLinux OpenNext buildとversion upload dry-run | Required check 候補 |
| `security-scan` | `npm audit` と CodeQL | `npm audit` は advisory |
| `dependency-review` | 依存関係レビュー (PR only) | 中程度以上で fail |
| `build-performance` | build 時間とサイズの計測 (PR only) | レポート用途 |

### Conflict Check (`conflict-check.yml`)

- PR to `main`: PR head に `origin/main` を merge して競合有無を確認
- `main` push: open PR 一覧をなめて mergeable 状態を再チェック
- 競合がある場合は PR コメントを作成/更新
- 競合が解消された場合は過去コメントを削除

### ローカル push helper

repo ルートの `npm run push:check-pr` は次をまとめて行います。

- 既に merged 済み PR に紐づく branch かどうかのガード
- 必要なら `git push`
- 対象 branch の open PR を `gh pr list` で確認
- mergeability pending の場合は retry 後に exit code `4`

主な exit code:

- `2`: open PR が conflicted (`mergeable=CONFLICTING` or `mergeStateStatus=DIRTY`)
- `4`: GitHub が mergeability をまだ計算中
- `5`: 現在の branch は既に merged PR に紐づいているので、新しい branch / PR を使うべき

## データ同期と補助ワークフロー

### Sync JSON Data from CSV (`sync-json-data.yml`)

- `data/akyo-data-ja.csv`, `data/akyo-data-en.csv`, `data/akyo-data-ko.csv` の変更で起動
- `npm run data:convert` で JSON を再生成
- 差分があれば JSON をコミットして push
- R2 へ `data/akyo-data-*.json` をアップロード
- `REVALIDATE_SECRET` があれば `/api/revalidate` を叩いて ISR と KV cache 更新を促す

### Validate Cloudflare Resources (`validate-cloudflare-resources.yml`)

この workflow は次を確認します。

- Wrangler 経由での R2 bucket access
- Wrangler 経由での KV namespace access
- CSV ファイル存在確認

ただし現行 YAML では CSV チェックが legacy path のままです。

- `data/akyo-data.csv`
- `data/akyo-data-US.csv`

現在の repo で使っている実ファイルは `data/akyo-data-ja.csv` と `data/akyo-data-en.csv` なので、CSV step の失敗は workflow drift である可能性を先に疑ってください。

### Weekly Security Audit (`security-audit.yml`)

- weekly/manual で実行
- `npm audit --json`
- Snyk scan (`SNYK_TOKEN` がある場合)
- CodeQL analyze
- outdated dependencies report
- 脆弱性が見つかった場合は GitHub Issue を自動作成

### Next.js Health Check (`nextjs-health-check.yml`)

- Next.js 関連ファイル変更時に実行
- App Router、deprecated pattern、Pages 互換性、画像設定などを grep ベースで確認
- 警告中心の advisory workflow であり、Cloudflare deploy の source of truth ではありません

注意:

- この workflow は `export const runtime = 'nodejs'` を warning することがあります。
- 本 repo には意図的に Node.js runtime を使う API route もあるため、警告はコード文脈と合わせて判断してください。

### Lint / Claude / Reusable Build

- `knip.yml`: `npm run knip` による dead-code 検査
- `claude-code-review.yml`: `@claude` メンション時のみ起動する補助 workflow
- `reusable-build.yml`: 将来の caller 向け build helper。現時点では本線 CI/deploy からは直接呼ばれていません

## 必要なシークレットと変数

### GitHub Actions 側

| 名前 | 主な用途 | 必須 |
| ---- | -------- | ---- |
| `CLOUDFLARE_API_TOKEN` | Deploy / Preview Gate | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy / Preview Gate | Yes |
| `CLOUDFLARE_PAGES_PROJECT` | Deploy / Preview Gate の project 解決 | Recommended |
| `CLOUDFLARE_PAGES_PREVIEW_PROJECT` | 公開read-only PR Preview project の解決 | Recommended |
| `NEXT_PUBLIC_SITE_URL` | build-time fallback | Optional |
| `NEXT_PUBLIC_R2_BASE` | build-time fallback | Optional |
| `DEFAULT_ADMIN_PASSWORD_HASH` | legacy build fallback | Optional |
| `DEFAULT_OWNER_PASSWORD_HASH` | legacy build fallback | Optional |
| `DEFAULT_JWT_SECRET` | legacy build fallback | Optional |
| `R2_ACCESS_KEY_ID` | JSON sync の R2 upload | `sync-json-data.yml` で必須 |
| `R2_SECRET_ACCESS_KEY` | JSON sync の R2 upload | `sync-json-data.yml` で必須 |
| `REVALIDATE_SECRET` | JSON sync 後の ISR 再検証 | Recommended |
| `SNYK_TOKEN` | Weekly Security Audit | Optional |
| `ANTHROPIC_API_KEY` | Claude Code Review | `@claude` workflow で必須 |

### Cloudflare runtime 側

| 名前 | 用途 |
| ---- | ---- |
| `ADMIN_PASSWORD_OWNER` | owner login |
| `ADMIN_PASSWORD_ADMIN` | admin login |
| `SESSION_SECRET` | session HMAC signing |
| `NEXT_PUBLIC_APP_URL` | CSRF origin 判定 |
| `NEXT_PUBLIC_R2_BASE` | public image/data base URL |
| `GITHUB_TOKEN` / `GITHUB_*` | admin-side CSV sync |
| `REVALIDATE_SECRET` | `/api/revalidate` |
| `SENTRY_DSN` | Workers server-side Sentry |

## トラブルシューティング

### Pages PR Preview がskipされた

- fork、Dependabot、Draft PRか確認してください。
- forkとDependabotでは`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`を使用しないためskipが正常です。
- fork PR の author が自力で確認できるのは GitHub 上の CI と一般的なアプリ動作までです。Cloudflare preview / secrets 依存の確認は maintainer 側で行う必要があります。

### Pages PR Preview がtimeout / failedになった

1. `CLOUDFLARE_PAGES_PREVIEW_PROJECT` の値を確認する（既定値は`akyodex-pr-preview`）
2. Cloudflare PagesのPreview deployment一覧で`pr-N`と対象commitを探す
3. `preview_deployment_setting=none`が直接アップロードを拒否していないかActionsログを確認する
4. 不変URLの`/zukan`、完全カタログAPI、画像APIを個別に確認する
5. 必要ならrerunする

### Deploy workflow が `missing_url` になった

- deploy 自体は完了している可能性があります。
- Step Summary と Cloudflare Pages dashboard の deployment URL を確認してください。

### ロールバックしたい

Workers本番切替後の最短経路は、`Deploy Cloudflare Workers Production`を`rollback-pages`で手動実行し、`akyodex.com/*`のWorker routeを外して固定済みPagesへ戻すことです。Pagesを再ビルドする必要がある場合だけ、`pages-rollback`ブランチから`Deploy Cloudflare Pages Rollback`を手動実行します。

- Worker routeのrollback: routeを外して`akyodex.pages.dev`と同じ固定Pagesへ戻す
- Workersコードのrollback: WranglerまたはDashboardから既知の正常なWorker versionへ戻す
- データ変更のrollback: KV、R2、D1、GitHub上のCSV/JSONをコードversionとは別に確認する

### `npm run push:check-pr` が失敗した

- `2`: PR conflict を解消する
- `4`: 少し待って再実行する
- `5`: その branch は既に merged PR に紐づいているので、新しい branch を切る

### `Validate Cloudflare Resources` の CSV step だけ失敗した

- まず workflow が legacy CSV path を見ていないか確認してください。
- 現状は `data/akyo-data.csv` / `data/akyo-data-US.csv` を前提としているため、repo 側の実ファイル名と一致しません。

---

**最終更新**: 2026-08-28
**対象実装**: `.github/workflows/*.yml`, `wrangler.workers*.jsonc`, `scripts/push-and-check-pr-conflicts.js`, `open-next.config.ts`, `scripts/prepare-cloudflare-pages.js`
