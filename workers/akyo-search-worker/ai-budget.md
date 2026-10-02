# Shared AI budget

This change is not active merely because it is merged. Complete the coordinated
rollout below before claiming budget protection. Do not publish Dify or deploy
the Worker as a side effect of reviewing this PR.

## Scope and guarantee

Before each inference, reserve its **maximum** Neuron cost in the existing D1
database. A single `INSERT ... SELECT ... RETURNING` serializes the allowance
check and reservation across Worker instances and the GitHub sync client. A
missing schema, disabled configuration, database error or insufficient allowance
prevents inference. There is no per-process/KV counter or post-hoc spending check.

The initial ceiling is **8,000 Neurons over a rolling 24 hours**, with 2,000 left
below Workers AI's published 10,000/day free allocation. Active reservations plus
recent completed charges may never exceed the configured ceiling. This is an
application AI-inference ceiling, **not a Cloudflare account billing cap**: the
existing paid plan, Worker requests, D1, Vectorize, R2, other applications, direct
API calls and Playground usage are outside it. They still need their own usage
review. Other callers must not consume the remaining free allowance unchecked.

All three production inference paths must use the ledger:

| Path | Enforcement |
| --- | --- |
| Public discovery search and legacy ingest | `embedBudgeted` before the AI binding |
| Automatic catalog sync | REST client's reservation before each embedding batch |
| Dify's remaining LLM answers | Authenticated `/v1/chat/completions` proxy; no direct Cloudflare provider/fallback |

Number, latest, exact-name and deterministic count/filter answers require no AI
reservation and remain available. Exhausted discovery still returns D1 partial
matches with `budgetLimited: true`; only when none exist does it return `clarification` with `directAnswer`,
consumed by the existing Dify direct-answer branch. The chat
proxy returns a fixed completion (including SSE framing) without asking a model
to explain the outage. Sync checks budget-table readiness before changing catalog
rows, and reserves again before each inference. If another caller exhausts the
budget after that check, already-written rows remain; no later deletion runs, and
the next permitted sync can resume.

## Bounds (checked 2026-10-03)

| Model | Maximum used for reservation | Reserved Neurons |
| --- | --- | --- |
| `@cf/baai/bge-m3` | Input-specific tokenizer bound at 1,075/M, capped at 60,000 tokens/text | Round up once per batch of at most 20 texts |
| `@cf/zai-org/glm-4.7-flash` | 131,072 input tokens at 5,500/M plus 1,024 output at 36,400/M | 800 per call |

The embedding bound is `min(60000, 2 * text.normalize('NFKD').length + 2)` per
text. Sum those bounds, multiply by `1075 / 1000000`, then round up once per
request (minimum 1 Neuron). This is not the unsafe claim that original UTF-8 bytes
always bound tokens: U+FDFA, for example, compatibility-expands to 18 characters.

The bound assumes the published BGE M3 XLM-R tokenizer: compatibility normalization,
Unigram with no byte fallback, Metaspace prefixes, and two sequence special tokens.
NFKD decomposes at least as far as NFKC; UTF-16 length bounds code points. Doubling
also covers a prefix for each segment, including segments separated by literal
special tokens. The input sent to AI is unchanged; this normalization is for
accounting only, so existing vectors do not need rebuilding. The published
[tokenizer at revision 31e47391fcbda65be526abe98e646b3c6cd845a8](https://huggingface.co/BAAI/bge-m3/blob/31e47391fcbda65be526abe98e646b3c6cd845a8/tokenizer.json)
was checked locally against all 1,112,064 Unicode scalar normalizations and the
1,025 catalog records plus adversarial special-token/Unicode strings. No bound
violations occurred. Cloudflare's hosted tokenizer is an external assumption;
recheck the bound if its model implementation changes.

Embeddings retain their input-specific conservative charge. A complete, valid chat response may reduce its
charge using the provider's validated token usage, rounded **up**. Missing or
invalid usage retains 800. Only the fixed models are allowed; the proxy caps
`max_completion_tokens`, fixes `n=1`, disallows tools/media, and limits requests
to 64 KiB / 24 text messages. Public search rejects query/keyword strings over
4,096 UTF-8 bytes **before or after NFKD normalization**, and more than 24 keyword
candidates, before querying D1 or AI. Original text is still sent unchanged. The
post-normalization cap prevents compatibility ligatures from inflating a short
request's reservation. A maximum-length admitted term reserves at most 9 Neurons
(at most three terms reach inference). This is not abuse/rate limiting: sustained
public requests can still consume the shared allowance.
The proxy buffers upstream completion before
returning JSON or a final SSE chunk; it does not stream token-by-token.

Model limits and prices are external assumptions, not immutable contracts.
Re-audit these bounds before model/price changes. With the current 1,025-row
catalog, a full rebuild reserves 241 Neurons and the first 150 rows with an added
category reserve 34. A short search reserves 1, not 65. Real local D1 tests perform
500 short embeddings and then generation, without reaching the 8,000 cap. These
are ledger charges, not measured Cloudflare billing. Long texts and future
catalogs can cost more; do not bypass the ceiling for a larger rebuild.

Sources:
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [BGE M3 context](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [GLM context and completion limit](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Why AI Gateway's eventually consistent spend limits are not a strict cap](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)

## Failure and time rules

- Completed charges age out 24 hours after **completion**, not request start or
  local midnight. In-flight usage stays reserved across the UTC reset boundary.
- A complete HTTP error, invalid JSON, empty completion or invalid embedding is
  **settled at the full reservation** at response completion. It therefore ages
  out after 24 hours, without refunding potentially billed inference. The binding
  uses `returnRawResponse: true` to distinguish HTTP errors from transport loss.
- A rejected transport call, truncated/lost body, disconnected request whose
  handler was terminated, or unacknowledged ledger write is still **pending**.
  These uncertain holds do not auto-expire: neither Worker HTTP duration nor the
  Workers AI limits documentation supplies a one-hour inference deadline. We do
  not equate a client timeout with proof the provider stopped. Repeated lost
  responses can still require manual recovery; this remaining availability cost
  must not be represented as solved. Ten lost chat responses can still fill 8,000
  **cumulatively over months**, not just ten concurrent failures.
- The Worker registers its request promise with `ctx.waitUntil` before awaiting
  inference. The same promise includes reading the upstream body and settlement;
  it does not launch inference a second time. Cloudflare allows up to 30 seconds
  after caller disconnection, not unlimited execution. A longer inference or
  terminated invocation can still leave a hold. See [context lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).
  A local workerd smoke test disconnects HTTP while a fake provider is blocked
  and verifies subsequent settlement in real D1. That runtime also continued
  without `waitUntil`, so the three route-level registration tests separately
  detect its removal. Neither test proves hosted Cloudflare cancellation timing.
- Caught transport/body losses log `ai_budget_hold` / `response_lost`; failed
  settlements log `ai_budget_hold` / `settlement_failed`. Both include only the
  random `reservationId` and `units`, never request text, tokens or upstream
  exception contents. For settlement failures, `units` is the attempted charge;
  the pending row can still hold the larger original reservation. Process kills
  cannot reliably emit this warning: inspect pending rows as well as logs.
- A failed settlement keeps the reservation. Repeating a successful settlement
  cannot lower the amount again or move its expiration.
- The sync REST client does not automatically retry an uncertain AI call. A new
  sync or Dify retry must acquire another reservation before another inference.
- The database holds only random reservation IDs, amounts and timestamps, never
  questions, credentials or catalog text. Completed history is retained for
  auditing; any future cleanup must exclude pending/recent rows.

## Coordinated rollout (separate approval required)

1. **Before merging**, save the deployed Worker version and Dify export. Pause
   automatic AI catalog sync (`AI_CATALOG_SYNC_ENABLED=false`) and wait for active
   syncs to finish. This PR also adds a separate `AI_BUDGET_READY=true` opt-in:
   absent/false means automatic jobs skip and manual apply is rejected; manual
   dry run remains available. Merging alone must never start an unready writer.
   Catalog edits remain usable while paused, but AI indexing waits for resumption.
2. Apply `sql/ai-budget.sql` to `akyo-database` with Wrangler's **remote** D1
   execute command after reviewing the SQL. It creates independent budget tables
   with **enabled=0**, changes no catalog rows, and is idempotent. Never reset or
   truncate an existing ledger on deployment.
3. Set a dedicated random `CHAT_TOKEN` Worker secret, distinct from ingest/sync
   credentials. Deploy this Worker. While disabled, semantic inference stops;
   deterministic lookups still work. Do not print or commit the token.
4. Configure Dify's OpenAI-compatible provider to this Worker's `/v1` base URL,
   model `@cf/zai-org/glm-4.7-flash`, with `CHAT_TOKEN` as the API key. Set maximum
   completion tokens to at most 1,024 and maximum retries to one. Remove direct
   Cloudflare provider fallback. In the draft, verify JSON/SSE, the fixed budget
   warning, zero-result/direct-answer branches, names/numbers/counts, and a normal
   generation path in an isolated test ledger. Local protocol tests do **not**
   prove Dify provider compatibility or real model usage reporting.
5. Publish the verified Dify graph and remove its former direct Cloudflare
   credential so older graphs cannot bypass the proxy. Wait for prior unguarded
   inference to end. Keep the ledger disabled until either the preceding 24h
   usage is conservatively imported as a charge, **or** no unguarded inference
   has run for a full 24h. Do not enable a fresh zero balance in the middle of an
   already-used day and call that a strict free-tier guarantee.
6. Enable with `UPDATE ai_budget_config SET enabled = 1 WHERE id = 1;` only after
   the cutover accounting is verified. Set `AI_BUDGET_READY=true` and re-enable
   catalog sync, run dry-run/apply,
   and check the shared ledger. Confirm a small-limit staging test stops inference
   under concurrent traffic while ordinary lookups continue. Do not exhaust the
   production account just to test this.
7. This PR also changes scripts/Worker code outside the site's automatic release
   allow-list. Check the production release gate and perform the separately
   approved site activate to restore automatic font/color activation if blocked.

The old direct provider remains a bypass until step 5. Installation alone is not
protection. Standard Cloudflare account alerts can supplement this mechanism but
cannot replace any step above.

If Dify compatibility fails, stop the cutover and keep generation paused while
repairing the draft. Leaving its direct provider connected is **not** a protected
fallback; search/sync protection alone does not satisfy the shared inference cap.

The coordinated cutover still has a semantic/generation pause. Importing a
verified conservative bound for earlier usage avoids a mandatory 24-hour wait;
without that evidence, the wait remains necessary. This change does not promise
zero-downtime introduction. Dify compatibility and buffered-answer UX still need
draft verification before deployment/publication is approved.

### Importing earlier usage before enabling

Use this only for the **first** guarded cutover. Stop every unguarded caller and
prove its outstanding calls have ended first. Obtain a rounded-up Neuron upper
bound covering **all account inference during the preceding 24 hours**, including
sync, Dify, Playground and other apps. A lagging dashboard sample alone is not
proof that all usage is included. Keep the source/time window and allowance for
unreported usage in the release record. If a reliable upper bound is unavailable,
keep inference disabled for 24 hours after the last unguarded call ended instead.
If the bound exceeds 8,000, do not clamp it: keep disabled until a later verified
window fits or the full wait ends. A verified zero needs no imported row.

For a positive bound of 1..8,000, copy `sql/ai-budget-carry.sql` to a local reviewed
`ai-budget-carry.reviewed.sql` and replace `REPLACE_WITH_VERIFIED_NEURONS` with that integer. The
unmodified file deliberately cannot execute. With the Worker directory as cwd:

```powershell
npx wrangler d1 execute akyo-database --remote --config wrangler.jsonc --file ./ai-budget-carry.reviewed.sql
```

The insert requires `enabled=0`. Verify it returns **one row** with ID
`unguarded-cutover-v1`, units at least the reviewed bound, and a current
`completed_at`. Zero returned rows means **stop**, not success. Repeating it uses
the same ID, never lowers the charge, and conservatively restarts its full 24-hour
retention. It never deletes or completes unrelated pending reservations. Do not
reuse this ID for a later separate unguarded period; that needs separately reviewed
accounting. Before enabling, run:

```sql
SELECT id, units, created_at, completed_at FROM ai_budget_reservations
WHERE id = 'unguarded-cutover-v1';
SELECT enabled, limit_neurons,
       limit_neurons - (SELECT COALESCE(SUM(units), 0) FROM ai_budget_reservations
         WHERE completed_at IS NULL OR completed_at > unixepoch() - 86400) AS remaining
FROM ai_budget_config WHERE id = 1;
```

Confirm the carry row, any guarded verification usage, and other pending holds
are all included. Only then perform step 6. A zero remaining allowance is a valid
accounted state but will keep inference stopped until completed charges age out.
Do not run unguarded test calls after recording the bound.

## Operations and recovery

Inspect only non-sensitive budget state:

```sql
SELECT enabled, limit_neurons FROM ai_budget_config WHERE id = 1;
SELECT COALESCE(SUM(units), 0) AS reserved_or_recent,
       COUNT(*) AS reservations
FROM ai_budget_reservations
WHERE completed_at IS NULL OR completed_at > unixepoch() - 86400;
SELECT id, units, created_at FROM ai_budget_reservations
WHERE completed_at IS NULL ORDER BY created_at;
SELECT COUNT(*) AS pending_count, COALESCE(SUM(units), 0) AS pending_units,
       MIN(created_at) AS oldest_pending
FROM ai_budget_reservations WHERE completed_at IS NULL;
```

To stop all covered inference immediately, set `enabled=0`. Do not delete charges
to restore availability. Investigate old pending reservations; only after proving
the upstream has finished, mark them completed **at the current time retaining
their full units**. They then remain charged for another 24h. If the ledger is
unavailable, restore the database before enabling inference.

Check pending totals during rollout and routine usage reviews, not only after a
budget rejection. Logs make caught losses inspectable in Workers Logs (and sync
Actions logs); this PR does not install an alert/notification monitor. Review
Cloudflare's invocation-cancelled warnings too. Do not infer no holds from no logs.

Rolling back to the old Worker or direct Dify provider removes protection. Prefer
keeping the budget-aware version disabled while repairing it; do not claim the
cap survives an unguarded rollback.
