# Quick Start Guide - CI/CD Workflows

このガイドでは、Akyodex プロジェクトの CI/CD ワークフローを最短で稼働させる手順を説明します。

## 📋 前提条件

- GitHub リポジトリへの管理者アクセス
- Cloudflare アカウント (Pages, R2, KV 使用可能)
- Cloudflare Pages プロジェクト作成済み

## 🚀 5分でセットアップ

### ステップ 1: Cloudflare API トークンを取得 (2分)

1. **Cloudflare ダッシュボードにログイン**
   ```
   https://dash.cloudflare.com/
   ```

2. **API トークンを作成**
   - My Profile → API Tokens → Create Token
   - "Edit Cloudflare Workers" テンプレートを選択
   - 以下の権限を付与：
     * Account → Cloudflare Pages → Edit
     * Account → Account Settings → Read
   - Create Token をクリック

3. **トークンとアカウント ID をコピー**
   - API Token: `abc123...` (後で使用)
   - Account ID: ダッシュボードの URL から確認
     * `https://dash.cloudflare.com/[ACCOUNT_ID]/...`

### ステップ 2: GitHub Secrets を設定 (2分)

1. **GitHub リポジトリにアクセス**
   ```
   https://github.com/rad-vrc/Akyodex
   ```

2. **Settings → Secrets and variables → Actions**

3. **必須の Secrets を追加**
   
   **New repository secret** をクリックして、以下を追加：

   #### CLOUDFLARE_API_TOKEN
   ```
   Name: CLOUDFLARE_API_TOKEN
   Value: [ステップ1で取得したトークン]
   ```

   #### CLOUDFLARE_ACCOUNT_ID
   ```
   Name: CLOUDFLARE_ACCOUNT_ID
   Value: [ステップ1で取得したアカウントID]
   ```

### ステップ 3: GitHub Variables を設定 (2分)

より安全なビルドのために、以下を設定（必須）：

#### パスワードハッシュを生成
```bash
# ローカル環境で実行
node -e "const crypto = require('crypto'); const password = 'BuildTimePassword123'; console.log('Hash:', crypto.createHash('sha256').update(password).digest('hex'));"

# JWT シークレットを生成
openssl rand -hex 64
```

#### GitHub Variables に追加
1. **Settings → Secrets and variables → Actions → Variables タブ**
2. **New repository variable** をクリック

追加する変数：
```
Name: DEFAULT_ADMIN_PASSWORD_HASH
Value: [生成されたハッシュ]

Name: DEFAULT_OWNER_PASSWORD_HASH
Value: [生成されたハッシュ]

Name: DEFAULT_JWT_SECRET
Value: [生成した64バイトのシークレット]
```

**注意**: これらは CI/CD ビルド用の値です。本番環境の値は Cloudflare Pages で設定してください。

### ステップ 4: ワークフローを有効化 (即座)

1. **Actions タブにアクセス**
   ```
   https://github.com/rad-vrc/Akyodex/actions
   ```

2. **ワークフローを確認**
   - CI - Continuous Integration
   - Deploy to Cloudflare Pages
   - Weekly Security Audit
   - Validate Cloudflare Resources

3. **自動的に有効化される**
   - PR を作成すると CI が自動実行
   - main ブランチに push するとデプロイが自動実行

## ✅ 動作確認

### テスト 1: CI ワークフロー

```bash
# 1. テストブランチを作成
git checkout -b test/ci-workflow

# 2. 小さな変更をコミット
echo "# Test" >> README.md
git add README.md
git commit -m "test: CI workflow"

# 3. プッシュ
git push origin test/ci-workflow

# 4. PR を作成
# GitHub UI で PR を作成

# 5. Actions タブで実行状況を確認
# https://github.com/rad-vrc/Akyodex/actions
```

**期待される結果**:
- ✅ Lint & Type Check が成功
- ✅ Build Validation が成功
- ✅ Security Scan が成功
- ✅ Dependency Review が成功
- ✅ Build Performance Report が生成される

### テスト 2: デプロイワークフロー

```bash
# 1. main ブランチに変更をマージ
# (PR をマージ)

# 2. Actions タブで確認
# "Deploy to Cloudflare Pages" が自動実行される

# 3. デプロイ URL を確認
# ワークフローの Summary に表示される
```

**期待される結果**:
- ✅ ビルドが成功
- ✅ Cloudflare Pages にデプロイされる
- ✅ デプロイ URL が生成される

### テスト 3: 手動デプロイ

```bash
# 1. Actions タブにアクセス
# 2. "Deploy to Cloudflare Pages" を選択
# 3. "Run workflow" をクリック
# 4. Environment を選択 (production/staging)
# 5. "Run workflow" を実行
```

## 📊 トラブルシューティング

### 問題: ビルドが失敗する

#### エラー: "Invalid API token"

**解決策**:
1. CLOUDFLARE_API_TOKEN が正しいか確認
2. API トークンの権限を確認
3. トークンが期限切れでないか確認

```bash
# トークンをテスト
curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### エラー: "Cannot find module '@opennextjs/cloudflare'"

**解決策**:
1. `package-lock.json` の問題の可能性
2. ワークフローが `npm ci` を使用していることを確認

### 問題: Pages PR Previewのデプロイが失敗する

#### エラー: "Project not found"

**解決策**:
1. Cloudflare Pages で専用の`akyodex-pr-preview`プロジェクトが作成されているか確認
2. `deploy-cloudflare-pages-preview.yml` のプロジェクト名を確認
   ```yaml
   command: pages deploy .open-next --project-name=akyodex-pr-preview
   ```

#### エラー: "Build output directory not found"

**解決策**:
1. ビルドが成功していることを確認
2. `.open-next` ディレクトリが生成されているか確認

### 問題: セキュリティ監査が失敗する

#### 多数の脆弱性が見つかった

**対応**:
1. `npm audit` を実行
2. `npm audit fix` で自動修正を試す
3. 手動で依存関係をアップデート

```bash
npm audit
npm audit fix
# または
npm update [package-name]
```

## 🔧 カスタマイズ

### ワークフローのトリガーを変更

#### CI をスキップする場合

コミットメッセージに `[skip ci]` を含める:
```bash
git commit -m "docs: Update README [skip ci]"
```

#### 特定のブランチでのみ実行

`.github/workflows/ci.yml` を編集:
```yaml
on:
  pull_request:
    branches:
      - main
      - develop
      - feature/*  # feature/* ブランチも追加
```

### セキュリティ監査の頻度を変更

`.github/workflows/security-audit.yml` を編集:
```yaml
on:
  schedule:
    # 毎週月曜日 → 毎日に変更
    - cron: '0 9 * * *'  # 毎日 9:00 UTC
```

### ビルドタイムアウトを調整

`.github/workflows/ci.yml` を編集:
```yaml
- name: Build for Cloudflare Pages
  run: npm run build
  timeout-minutes: 10  # デフォルト: 360分
```

## 📚 次のステップ

1. **詳細なドキュメント**
   - `.github/workflows/README.md` - 完全なドキュメント
   - `.github/workflows/ARCHITECTURE.md` - アーキテクチャ図

2. **ワークフローの監視**
   - Actions タブで実行履歴を確認
   - 失敗時は詳細ログを確認

3. **セキュリティの強化**
   - 定期的に依存関係をアップデート
   - CodeQL 警告に対応
   - Snyk を統合 (オプション)

4. **パフォーマンスの最適化**
   - ビルド時間を監視
   - キャッシュ設定を調整
   - 不要なジョブを削除

## 💡 ヒント

### ローカルでビルドをテスト

デプロイ前にローカルでテスト:
```bash
# 1. 依存関係をインストール
npm ci

# 2. ビルド
npm run build

# 3. ビルド成果物を確認
ls -la .open-next/

# 4. ローカルでプレビュー (オプション)
npx wrangler pages dev .open-next
```

### GitHub Actions のログを確認

```bash
# GitHub CLI を使用
gh run list
gh run view [RUN_ID]
gh run view [RUN_ID] --log
```

### ワークフローを手動実行

```bash
# 本番Worker候補をuploadする（trafficは変更しない）
gh workflow run deploy-cloudflare-workers-production.yml \
  -f action=upload
```

## 🎯 チェックリスト

セットアップが完了したら、以下を確認:

- [ ] CLOUDFLARE_API_TOKEN が設定されている (Secrets)
- [ ] CLOUDFLARE_ACCOUNT_ID が設定されている (Secrets)
- [ ] DEFAULT_ADMIN_PASSWORD_HASH が設定されている (Variables)
- [ ] DEFAULT_OWNER_PASSWORD_HASH が設定されている (Variables)
- [ ] DEFAULT_JWT_SECRET が設定されている (Variables)
- [ ] CI ワークフローが PR で実行される
- [ ] デプロイワークフローが main push で実行される
- [ ] ビルドが成功する
- [ ] デプロイが成功する
- [ ] セキュリティ監査が設定されている
- [ ] リソース検証が設定されている

## 📞 サポート

問題が解決しない場合:

1. **ドキュメントを確認**
   - `.github/workflows/README.md`
   - `.github/workflows/ARCHITECTURE.md`

2. **GitHub Issue を作成**
   - 具体的なエラーメッセージ
   - 実行ログのスクリーンショット
   - 環境情報 (Node.js バージョンなど)

3. **コミュニティに質問**
   - GitHub Discussions
   - Discord サーバー

---

**所要時間**: 5-10分
**難易度**: 初級
**最終更新**: 2025-11-07
