#!/usr/bin/env bash
set -euo pipefail

# Reinstall after checkout: a concurrent main update may also change dependencies.
npm ci

# Preserve the existing best-effort locale policy. Translation gaps use JA labels.
if node scripts/sync-akyo-data-en-from-ja.js && node scripts/generate-ko-data.js; then
  echo 'EN/KO CSV regenerated from JA'
else
  echo '::warning::EN/KO regeneration failed; keeping previous EN/KO CSVs'
  git restore -- data/akyo-data-en.csv data/akyo-data-ko.csv data/akyo-data-ko.json
fi

npm run data:convert

if ! npm run fonts:subset; then
  echo '::warning::Font subset regeneration failed; keeping existing subsets'
  git restore -- src/fonts/mplus2-variable.subset.woff2 src/fonts/subset-manifest.json
fi

if ! npm run categories:canonical; then
  echo '::warning::Category canonical map regeneration failed; keeping existing map'
  git restore -- src/lib/category-canonical.json
fi
