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
- Japanese, English, and Korean queries are detected when `language` is omitted.
- Exact ID, nickname, or avatar-name matches return without invoking Workers AI.
- All languages, including Korean, use the populated shared index. There is no
  Korean-specific binding, and the empty JA/EN indexes remain reserved.
- Semantic failures fall back to D1 results instead of returning an HTTP 500.
- Results are deduplicated, sorted, and globally limited after all searches.

## Endpoints

`GET /health` returns `{ "status": "ok" }`.

`POST /search` accepts a JSON object with `query` or `keywords`, plus optional
`language` (`ja`, `en`, or `ko`) and `topK`. It returns the detected language,
matching records, and `count`.

```json
{
  "query": "七夕Akyoについて教えて",
  "language": "ja",
  "topK": 5
}
```

`POST /count` accepts either `keyword` with an optional language or an exact
`author`. Keyword responses include up to 10 examples; author responses include
the total count and up to 10 avatars.

```json
{ "author": "roma38（ろま38）" }
```

`POST /insert-data` requires `Authorization: Bearer <INGEST_TOKEN>` and a
`records` array of at most 1,000 records. It returns D1 `processed` count,
Vectorize `indexed` count, `failed`, and per-record `errors`. Records are
committed to D1 as one transaction before their vectors are uploaded in bounded
batches; failed vector uploads can be retried safely because D1 writes use
`INSERT OR REPLACE`.

```json
{
  "records": [
    {
      "id": "0893",
      "nickname": "たなばたAkyo",
      "language": "ja"
    }
  ]
}
```

The old public `/debug-search` and `/test-author-filter` endpoints were not
restored because they exposed internal search diagnostics without authentication.
