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

`wrangler secret put` creates and deploys a new Worker version. Run it only as
part of the approved production rollout, after the source change has merged.
Use `wrangler versions secret put` instead when preparing a version without
immediately routing production traffic to it.

Send the same value as `Authorization: Bearer <token>` when uploading data.
Do not put the token in the repository or in a command committed to shell history.
The Wrangler configuration declares `INGEST_TOKEN` as required, so deployment
validation fails when the Worker secret is missing.

The upload helper reads the same value from `AKYO_INGEST_TOKEN`. Set
`AKYO_WORKER_URL` to exercise a preview Worker before using the production URL:

```powershell
$env:AKYO_INGEST_TOKEN = "<INGEST_TOKEN>"
$env:AKYO_WORKER_URL = "https://<preview-worker>/insert-data"
node scripts/upload-vectorize-data.js --batch-size 50
```

Neither environment variable should be committed. `--dry-run` does not require
the token because it does not send an HTTP request.

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
- Exact ID, nickname, or registered-name matches return without invoking Workers AI.
- Exact registered-name lookup searches all stored languages, preferring the
  detected language and then Japanese. This keeps Latin-only Japanese world
  names such as `AkyoLabo` discoverable without widening partial or semantic
  searches across languages.
- Every result includes `entryType` (`avatar` or `world`). Newly ingested
  records preserve the source value in Vectorize metadata. Existing D1 rows do
  not need a schema migration because the Worker safely infers worlds from
  VRChat `/world/` URLs.
- Queries that clearly name one Akyo (for example, `七夕Akyoについて教えて`
  `Akyoつりぼりについて教えて`, or `#Avatar0504`) use D1 only and return
  the best `id`, `nickname`, or `name` match. Semantic, category, author, and
  description searches are skipped so an unrelated record cannot be presented
  as the named one. A request with no `query` is treated the same way when
  `keywords` contains exactly one name; multiple keyword-only requests remain
  discovery searches.
- All languages, including Korean, use the populated shared index. There is no
  Korean-specific binding, and the empty JA/EN indexes remain reserved.
- Semantic failures fall back to D1 results instead of returning an HTTP 500.
- Results are deduplicated, sorted, and globally limited after all searches.

## Endpoints

`GET /health` returns `{ "status": "ok" }`.

`POST /search` accepts a JSON object with `query` or `keywords`, plus optional
`language` (`ja`, `en`, or `ko`) and `topK`. It returns the detected language,
matching records, and `count`.
`searchMode` is `specific-name` for a named Akyo lookup and `discovery` for a
general search. Specific-name responses also include `nameMatch`; when it is
`false`, `results` is empty even if Vectorize found semantically similar items.
Consumers must use each result's `entryType` to label it as an avatar or world;
world results should use `nickname` as the world name and label `url` as the
VRChat world URL.

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
      "entryType": "avatar",
      "nickname": "たなばたAkyo",
      "language": "ja"
    }
  ]
}
```

The old public `/debug-search` and `/test-author-filter` endpoints were not
restored because they exposed internal search diagnostics without authentication.
