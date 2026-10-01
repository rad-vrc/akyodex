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

## Catalog synchronization

`Sync AI Catalog` (`.github/workflows/sync-ai-catalog.yml`) keeps the existing
Japanese D1 table and shared Vectorize index aligned with the catalog. It runs
after a successful `Sync JSON Data from CSV`, including runs that pushed their
JSON commit with `GITHUB_TOKEN`. It is a separate workflow: AI failures do not
block publication of the catalog, fonts, or images.

Automatic writes are **disabled by default**. The repository variable
`AI_CATALOG_SYNC_ENABLED` must equal `true`. Manual dispatch defaults to
`apply=false` (read-only); `apply=true` also requires that variable and `main`.
The workflow uses the existing `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` secrets. The token needs D1 read/write, Vectorize
read/write, and Workers AI inference access for this account. Secret presence
does not prove those permissions; verify them during rollout. There is no new
public write endpoint or ingest secret.

Every run is serialized in `ai-catalog-production` (`queue: max`, no cancellation
of a running writer), checks out **current main**, and regenerates JSON locally
from that checkout's CSV. An old run must not restore its old event snapshot.
The workflow does not commit generated files and does not consume the historical
`data/vectorize-payload.json`. Until synchronization completes, search can still
lag behind a new CSV commit; this is not an atomic cross-service transaction.

- Validate the complete nonempty JA payload and inventory both D1 and Vectorize
  before writing. Unexpected IDs or non-JA records stop the run rather than
  guessing how to migrate them. Existing IDs remain stable.
- Upsert changed D1 rows; embed and upsert only missing/changed vectors. Compare
  each store separately so a previous D1 success / Vectorize failure can heal
  on retry. Metadata-only changes also regenerate the affected embedding.
- After all updates have been submitted successfully, delete absent rows and
  orphan vectors. If an update fails, pruning is skipped. A failure can leave a
  partially updated D1/index; rerun the workflow, not a stale payload upload.
- Verify all D1 rows and poll Vectorize metadata/deletions. An accepted mutation
  alone is not success. The timeout reports failure and the next run rechecks
  both stores. Query-index visibility may still lag metadata visibility briefly.
- The search Worker checks semantic candidates against D1, excluding deleted
  records and vectors whose metadata no longer matches. While embeddings catch
  up, exact/name/category lookups use D1 and semantic results can be fewer.

This deliberately preserves the current **JA-only** database/index. D1's primary
key is `id`, not `(language, id)`; uploading EN/KO under those IDs would replace
Japanese data. A multilingual schema/index migration is separate work. The
`latest` intent and result ordering are also unchanged: refreshed data alone does
not make a semantic search a chronological search.

### Rollout and recovery

After review and explicit production approval:

1. Merge, then deploy this **search Worker** with its existing configuration and
   secret. This is separate from the website's production activate workflow.
   Deploy the D1 guard before enabling data writes. Record the prior Worker
   version for rollback; do not rotate the ingest secret as part of this change.
2. Dispatch `sync-ai-catalog.yml` on `main` with `apply=false`. Inspect the source
   SHA and addition/update/deletion counts. This uses read APIs but no embedding
   inference or data mutations.
3. Set `AI_CATALOG_SYNC_ENABLED=true` and dispatch with `apply=true` for the first
   reconciliation. Enabling the variable also permits future successful CSV
   syncs to launch a queued AI sync. Workers AI inference and D1/Vectorize
   operations can incur usage/cost, especially the first reconciliation of old
   metadata. No free-tier assumption is made.
4. Check the workflow's D1/Vectorize verification, then `/search` for `2030` and
   `MenmeAkyo`, an updated category, and a known unchanged entry. Check the Dify
   chat by name, not a `latest` question. Test a subsequent normal catalog change
   to verify the automatic trigger; local mocks/CI do not prove this integration.

On failure, inspect the failed step and retry on main after resolving access or
service errors. To pause, set `AI_CATALOG_SYNC_ENABLED=false`; this prevents new
automatic runs and manual writes, but does not stop a write already in progress
or undo data changes. Cancel queued runs if necessary and let the active run
finish. Avoid concurrent manual `/insert-data` uploads: that legacy upsert-only
path does not share the Actions lock or remove deleted rows. Disable sync before
rolling the Worker back to a version without the D1 guard; that older Worker can
serve stale vectors during a later partial sync.

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
