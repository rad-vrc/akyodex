# Akyo Search Worker

This directory is the source of `akyo-search-worker.dorado1031.workers.dev`.
It was recovered from the deployed Cloudflare bundle and split back into
maintainable TypeScript modules.

## Bindings

The committed `wrangler.jsonc` mirrors the production bindings:

- `AI`: Workers AI
- `DB`: D1 database `akyo-database`
- `VECTORIZE`: fallback index `akyo-search-index`
- `VECTORIZE_JA`: reserved Japanese index `akyo-search-index-ja` (currently empty)
- `VECTORIZE_EN`: reserved English index `akyo-search-index-en` (currently empty)
- `INGEST_TOKEN`: secret required by `POST /insert-data`

Set the ingest secret before the first deployment:

```powershell
npx wrangler secret put INGEST_TOKEN --config workers/akyo-search-worker/wrangler.jsonc
```

Send the same value as `Authorization: Bearer <token>` when uploading data.
Do not put the token in the repository or in a command committed to shell history.

## Verification

```powershell
npm run test:worker
npm run typecheck:worker
npm run build:worker
```

`build:worker` performs a Wrangler dry run. Deployment remains a separate,
manual production action after review.

## Search behavior

- `topK` defaults to 5 and is clamped to 1-8.
- At most three input keywords are processed.
- Natural-language suffixes are removed before exact D1 lookup.
- Exact ID, nickname, or avatar-name matches return without invoking Workers AI.
- Searches use the populated shared index; the empty language indexes remain reserved.
- Semantic failures fall back to D1 results instead of returning an HTTP 500.
- Results are deduplicated, sorted, and globally limited after all searches.

The old public `/debug-search` and `/test-author-filter` endpoints were not
restored because they exposed internal search diagnostics without authentication.
