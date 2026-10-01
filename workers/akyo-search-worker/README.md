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
The workflow uses the existing `CLOUDFLARE_ACCOUNT_ID` and a dedicated
`AI_CATALOG_SYNC_API_TOKEN` secret. Grant only D1 read/write, Vectorize read/write,
and Workers AI inference access, scoped to the target account/resources wherever
supported. Do not expand or fall back to the deployment token
(`CLOUDFLARE_API_TOKEN`). The dedicated secret must be created and registered
before rollout; never paste its value in PRs or chat. Secret presence does not
prove its permissions. There is no new public write endpoint or ingest secret.

Every run is serialized in `ai-catalog-production` (`queue: max`, no cancellation
of a running writer), checks out **current main**, and regenerates JSON locally
from that checkout's CSV. An old run must not restore its old event snapshot.
The workflow does not commit generated files and does not consume the historical
`data/vectorize-payload.json`. Until synchronization completes, search can still
lag behind a new CSV commit; this is not an atomic cross-service transaction.

- Validate the complete nonempty JA payload and inventory both D1 and Vectorize
  before writing. Unexpected IDs or non-JA records stop the run rather than
  guessing how to migrate them. Existing IDs remain stable.
- If either store would lose more than **20 entries OR 5% of its current entries**,
  stop before any D1 write, inference, or vector mutation. D1 rows and orphan
  vectors have independent denominators. Exactly 20 and exactly 5% are allowed.
  Dry runs still report the plan and `requiresLargeDeletionApproval`, without
  writes. Only an enabled manual `apply=true` with `allow_large_deletion=true`
  can override this guard. Automatic runs cannot approve it; the CLI also checks
  `workflow_dispatch` for `--allow-large-deletion`.
- Upsert changed D1 rows; embed and upsert only missing/changed vectors. Compare
  each store separately so a previous D1 success / Vectorize failure can heal
  on retry. Metadata-only changes also regenerate the affected embedding.
- After all updates have been submitted successfully, delete absent rows and
  orphan vectors. If an update fails, pruning is skipped. A failure can leave a
  partially updated D1/index; rerun the workflow, not a stale payload upload.
- Verify all D1 rows and poll Vectorize metadata/deletions. An accepted mutation
  alone is not success. The timeout reports failure and the next run rechecks
  both stores. Query-index visibility may still lag metadata visibility briefly.
- The search Worker checks that semantic candidates still exist in D1 and match
  the requested language, then builds results exclusively from D1. Deletions
  cannot reappear via stale vectors, and names/categories/URLs are current as of
  D1. Live candidates stay available while re-embedding. Ranking can temporarily
  reflect older content (including an old category); if sync fails, this lasts
  until a successful retry. This is availability with current result fields,
  not a guarantee that the semantic ranking is already current.

This deliberately preserves the current **JA-only** database/index. D1's primary
key is `id`, not `(language, id)`; uploading EN/KO under those IDs would replace
Japanese data. A multilingual schema/index migration is separate work. The
latest-query path can fall back to JA records when the requested language has no
stored rows; each returned record keeps its actual `language`.

### Latest-query rollout

The synchronizer now stores the catalog's `urlUpdatedAt` in D1. On an enabled
apply it adds this column if absent, **after** inventory validation and the
large-deletion guard. Dry runs do not alter the schema. Timestamp-only updates
do not generate embeddings or change Vectorize metadata. Existing ingest updates
preserve this sync-owned column; ingestion does not assign chronology itself.

After merge, run a dry run, apply and a zero-diff dry run before deploying the
new search Worker. Do not deploy first and claim latest ordering is ready: a
missing column returns 503 instead of substituting semantic guesses, and a
partially completed initial timestamp backfill is not the final catalog order.
The column is additive, so ordinary name/discovery searches keep working on the
old Worker during sync. Rollback of the Worker does not require dropping it.

### Rollout and recovery

After review and explicit production approval:

Prerequisite: the existing D1-existence guard from #589 must already be deployed
(production uses it as of `173e21f8`). On a new installation, deploy that reviewed
pre-latest version first; do not expose latest search before its backfill.

1. Merge and register the dedicated sync secret. Dispatch `sync-ai-catalog.yml`
   on `main` with `apply=false` **before deploying the Worker**. Inspect the source
   SHA, update/deletion counts and deletion guard. This uses read APIs but no
   embedding inference or data mutations, and confirms only read permissions;
   it cannot prove write/inference permissions. Fix unexpected plans first.
2. Keep the currently deployed, guarded search Worker running. Record its
   version for rollback; do not rotate the ingest secret as part of this change.
   Set `AI_CATALOG_SYNC_ENABLED=true` and dispatch with `apply=true` for the first
   reconciliation. Enabling the variable also permits future successful CSV
   syncs to launch a queued AI sync. Workers AI inference and D1/Vectorize
   operations can incur usage/cost, especially the first reconciliation of old
   metadata. No free-tier assumption is made.
   If large deletions are intentional, review a fresh dry run and manually set
   `allow_large_deletion=true` as well. Every run uses current main, so repeat the
   dry run if main changed since review; do not set the override just to clear a
   failed run. Ordinary automatic updates keep the deletion guard enabled.
3. Wait for complete D1/Vectorize verification and run another read-only diff.
   Require zero remaining differences, including timestamps. Only then deploy
   this **search Worker** with its existing configuration and secret. This is
   separate from the website's production activate workflow.
4. Check `/search` for `2030`, `MenmeAkyo`, an updated category, and a known
   unchanged entry. Compare a latest query against the website's latest order.
   Check both named and latest questions in the actual Dify chat: local Worker
   tests do not prove what Dify sends or how it uses the response. Test a subsequent
   normal catalog change to verify the automatic trigger.

On failure, inspect the failed step and retry on main after resolving access or
service errors. To pause, set `AI_CATALOG_SYNC_ENABLED=false`; this prevents new
automatic runs and manual writes, but does not stop a write already in progress
or undo data changes. Cancel queued runs if necessary and let the active run
finish. Avoid concurrent manual `/insert-data` uploads: that legacy upsert-only
path does not share the Actions lock or remove deleted rows. Disable sync before
rolling the Worker back to a version without the D1 guard; that older Worker can
serve stale vectors during a later partial sync.

## Search behavior

- Unqualified latest requests such as `最新のAkyoは？`, `What is the latest Akyo?`
  and `최근 추가된 Akyo 알려주세요` bypass name/vector search. Keyword-only
  requests like `["最新", "Akyo"]` are also recognized. An explicit query takes
  precedence over generated keywords. Qualified/negated requests are not rewritten
  into a global latest query (for example, `最新の青いAkyo` is not supported as a
  chronological filter yet).
- Latest-intent matching only accepts raw phrases of at most 60 UTF-16 code
  units, before trimming or normalization. The same bound applies to every
  keyword, including a catalog noun such as `Akyo`. Bounded whitespace runs are
  collapsed before matching to prevent regex backtracking on crafted input.
  Longer queries still use ordinary search unchanged; they are not truncated or
  rejected, and an explicit nonblank query never falls back to latest keywords.
  Wording recognition remains deliberately narrow; verify actual Dify requests
  after deployment before expanding supported phrases.
- Latest results use the website's shared comparator: valid `urlUpdatedAt` first,
  descending by time, then descending numeric internal ID. This includes URL
  replacements and first BOOTH publication, not only newly registered records.
  Results declare `searchMode: "latest"` and
  `latestBasis: "urlUpdatedAt-desc-then-internal-id-desc"`. This is ordering,
  not semantic similarity. It reflects the most recent completed AI catalog sync,
  not an atomic view of a concurrent catalog update.
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

### Long queries

D1 limits a `LIKE` pattern to [50 UTF-8 bytes](https://developers.cloudflare.com/d1/platform/limits/),
including the surrounding `%` characters and the escapes for literal `%`, `_`,
and `\`. For example, 48 ASCII characters or 16 three-byte Japanese characters
fit, but one additional ASCII character does not. This applies to the normalized
search term, not the original question before natural-language cleanup.

Partial search, specific-name partial search, and keyword counts keep the existing
escaped `LIKE` for patterns within that limit. Longer patterns use
`instr(lower(column), lower(?)) > 0`, binding the entire unescaped search term.
No term is truncated, split, or discarded, and SQL's ASCII-only case folding is
preserved. Short patterns retain the existing LIKE behavior, including its NUL
handling; the long-input path treats embedded NUL as part of the literal term.
Exact matches, scoring, language filters, semantic input, and result limits are
unchanged. Unrelated D1 failures are not converted into empty successful results.

`src/long-query.test.ts` exercises the Worker request handler against real local
Miniflare D1, with only AI and Vectorize stubbed. It verifies D1's actual 50/51-byte
boundary using a nonempty test database, multilingual and escaped input, lexical
and semantic fallback, and counts. Miniflare is resolved through Wrangler's
existing dependency; no credentials, remote bindings, or production requests are
used. The suite is included in `npm run test:worker` and the existing CI worker
test step. Chronological "latest" intent routing and timestamp/schema changes
are separate work and are not implemented by this long-query fix.

## Endpoints

`GET /health` returns `{ "status": "ok" }`.

`POST /search` accepts a JSON object with `query` or `keywords`, plus optional
`language` (`ja`, `en`, or `ko`) and `topK`. It returns the detected language,
matching records, and `count`.
`searchMode` is `latest`, `specific-name` for a named Akyo lookup, or `discovery`
for a general search. Specific-name responses also include `nameMatch`; when it is
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
an upsert that preserves fields owned by catalog synchronization.

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
