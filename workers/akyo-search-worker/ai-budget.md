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
reservation and remain available. Exhausted discovery returns `clarification`
with `directAnswer`, consumed by the existing Dify direct-answer branch. The chat
proxy returns a fixed completion (including SSE framing) without asking a model
to explain the outage. Sync stops before inference and before any later deletion;
already-written catalog rows remain and the next permitted sync can resume.

## Bounds (checked 2026-10-03)

| Model | Maximum used for reservation | Reserved Neurons |
| --- | --- | --- |
| `@cf/baai/bge-m3` | 60,000 input tokens at 1,075/M | 65 per text; at most 20 texts/batch |
| `@cf/zai-org/glm-4.7-flash` | 131,072 input tokens at 5,500/M plus 1,024 output at 36,400/M | 800 per call |

No character/token heuristic is used to lower the reservation. Embeddings retain
their full conservative charge. A complete, valid chat response may reduce its
charge using the provider's validated token usage, rounded **up**. Missing or
invalid usage retains 800. Only the fixed models are allowed; the proxy caps
`max_completion_tokens`, fixes `n=1`, disallows tools/media, and limits requests
to 64 KiB / 24 text messages. The proxy buffers upstream completion before
returning JSON or a final SSE chunk; it does not stream token-by-token.

Model limits and prices are external assumptions, not immutable contracts.
Re-audit these bounds before model/price changes. The full-context embedding
reservation is deliberately conservative: 8,000 permits at most 123 embedding
texts/day if no chat runs, not an unlimited whole-catalog re-embedding. A large
rebuild must be staged across days or separately reviewed; do not bypass the cap.

Sources:
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [BGE M3 context](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [GLM context and completion limit](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Why AI Gateway's eventually consistent spend limits are not a strict cap](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)

## Failure and time rules

- Completed charges age out 24 hours after **completion**, not request start or
  local midnight. In-flight usage stays reserved across the UTC reset boundary.
- Failed, disconnected, malformed or uncertain upstream calls keep their entire
  **pending** reservation indefinitely. A timeout does not prove inference stopped.
- A failed settlement keeps the reservation. Repeating a successful settlement
  cannot lower the amount again or move its expiration.
- The sync REST client does not automatically retry an uncertain AI call. A new
  sync or Dify retry must acquire another reservation before another inference.
- The database holds only random reservation IDs, amounts and timestamps, never
  questions, credentials or catalog text. Completed history is retained for
  auditing; any future cleanup must exclude pending/recent rows.

## Coordinated rollout (separate approval required)

1. Save the deployed Worker version and Dify export. Pause automatic AI catalog
   sync (`AI_CATALOG_SYNC_ENABLED=false`) and wait for active syncs to finish.
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
   the cutover accounting is verified. Re-enable catalog sync, run dry-run/apply,
   and check the shared ledger. Confirm a small-limit staging test stops inference
   under concurrent traffic while ordinary lookups continue. Do not exhaust the
   production account just to test this.
7. This PR also changes scripts/Worker code outside the site's automatic release
   allow-list. Check the production release gate and perform the separately
   approved site activate to restore automatic font/color activation if blocked.

The old direct provider remains a bypass until step 5. Installation alone is not
protection. Standard Cloudflare account alerts can supplement this mechanism but
cannot replace any step above.

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
```

To stop all covered inference immediately, set `enabled=0`. Do not delete charges
to restore availability. Investigate old pending reservations; only after proving
the upstream has finished, mark them completed **at the current time retaining
their full units**. They then remain charged for another 24h. If the ledger is
unavailable, restore the database before enabling inference.

Rolling back to the old Worker or direct Dify provider removes protection. Prefer
keeping the budget-aware version disabled while repairing it; do not claim the
cap survives an unguarded rollback.
