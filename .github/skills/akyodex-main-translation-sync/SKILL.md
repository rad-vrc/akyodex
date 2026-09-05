---
name: akyodex-main-translation-sync
description: Sync Akyodex work with the latest main branch, regenerate English and Korean translation data from Japanese source CSV, validate generated files, and prepare a PR back to main. Use when Japanese rows/categories/comments changed and en/ko data must be refreshed safely.
---

# Akyodex Main Translation Sync

## Overview

Use this workflow for translation refresh tasks (run from the repository root):

- Bring branch up to date with `origin/main`
- Regenerate `data/akyo-data-en.csv` and `data/akyo-data-ko.csv`
- Regenerate JSON cache files
- Run CSV/type checks
- Commit and open PR to `main`
- If Japanese categories are renamed/reorganized, always apply equivalent EN/KO category-map updates in the same change

## Workflow

1. Confirm repository and clean state.
2. Sync with `origin/main` (choose one of two branch strategies).
3. Regenerate EN/KO and JSON files.
4. Validate outputs.
5. Commit, push, and open PR.

## Step 1: Preflight

Run:

```bash
pwd
git status --short --branch
```

If the worktree is dirty, stop and ask whether to stash/commit first.

## Step 2: Sync with Main

### Option A: New translation branch from latest main

Use when starting a fresh translation update PR.

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b chore/sync-en-ko-translation
```

### Option B: Continue existing branch and rebase onto main

Use when translation work is already on a feature branch.

```bash
git fetch origin
git rebase origin/main
```

If rebase conflicts occur, resolve conflicts, `git rebase --continue`, and rerun Step 4 validation (`npm run test:csv` + `npx tsc --noEmit --incremental false`).

## Step 3: Regenerate Translation Data

Before running generation, confirm translation maps are updated when JA data changed:

**Category translations** (when JA category tokens changed):
- `data/category-translations.json` (JA -> EN and KO category tokens, one entry per JA token in use; both generators fail listing the missing tokens, and `scripts/category-translations.test.js` rejects unused entries)

**Nickname / Comment maps** (when new rows are added):
- `scripts/sync-akyo-data-en-from-ja.js` → `overridesById` object (EN nickname + comment overrides)
- `scripts/nickname-map-ko.js` → `NICKNAME_MAP` (KO nickname translations)
- `scripts/generate-ko-data.js` → `COMMENT_MAP` (KO comment translations)

Run in this order:

```bash
node scripts/sync-akyo-data-en-from-ja.js
node scripts/generate-ko-data.js
npm run data:convert
```

Expected changed files typically include:

- `data/akyo-data-en.csv`
- `data/akyo-data-ko.csv`
- `data/akyo-data-ja.json`
- `data/akyo-data-en.json`
- `data/akyo-data-ko.json`

## Step 4: Validate

Run:

```bash
npm run test:csv
npx tsc --noEmit --incremental false
```

- `test:csv` 成功時: 出力末尾にエラーなし。失敗時はカテゴリマップ不足やCSV構造異常が原因。
- `tsc` 成功時: 出力なし（exit 0）。失敗時は JSON 型定義と生成データの不整合が原因。

どちらか失敗したら、該当マップファイルまたはCSVを修正してから次へ進む。

## Step 5: Commit and PR

Review and commit:

```bash
git status --short
git diff -- data/ scripts/
git add data/ scripts/
git commit -m "chore: sync en/ko translation data from ja"
```

Push and create PR:

```bash
git push -u origin HEAD
gh pr create --base main --fill
```

## Reporting

When finishing, report:

- Branch used and sync strategy (Option A or B)
- Files changed
- Validation results (`test:csv`, `tsc`)
- PR number/link (if created)
