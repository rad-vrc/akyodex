# Catalog load diagnostics

This instruments the transition from the initial 12 cards to the complete catalog
and enabled filters. It does not change source order, preloading, caching, the
15-second deadline, or retry behavior. It is not itself a latency fix. Measurements
start at the client's full-catalog fetch, not at navigation or the initial SSR render;
the time spent downloading JavaScript and hydrating before that is outside this interval.

## What is recorded

The existing sampled `catalog.ready` span now contains up to three request attempts.
Successful loads taking at least 3,000 ms also produce a warning with fingerprint
`catalog-slow-load`, at most once per mounted catalog view. Fast successes do not
produce an additional event. Existing failure events include attempt timings too.
The message counter avoids Sentry's adjacent-event deduplication; it is not a user ID.
These warnings do not use tracing's 10% sample rate, but delivery can still be lost
to blocking, offline clients, SDK filtering, or quotas. Lighthouse suppression and
the DSN requirement remain unchanged.

Browser fields:

- `headersWaitMs`: from calling fetch to its resolution, including browser scheduling,
  preload/cache behavior, network and server time. This is NOT network-only TTFB.
- `bodyAndParseMs`: waiting for the body AND JSON parsing, not transfer time alone.
- `totalMs`: whole source attempt including normalization. `null` means a stage did
  not complete/start; it is not zero. Status and outcome identify failed attempts.
- Existing normalization, search-index and state-apply durations remain separate.
- Visibility at start/end is only a pair of observations, not proof that the tab
  was visible throughout or that no freeze occurred.

The public API emits `Server-Timing` fields, copied into the same browser event:

- `catalog_kv`: compact catalog KV read (including binding/context setup).
- `catalog_load`: existing fallback loader as a whole; it does NOT distinguish its
  internal raw KV, R2 and CSV sources yet.
- `catalog_serialize`: payload serialization/revision generation.
- `catalog_handler`: complete route-handler interval.
- `catalog_worker`: outer Worker dispatch until response headers are ready, including
  OpenNext dispatch, but excluding isolate startup before this wrapper and body streaming.
- `catalog_source`: compact KV payload or fallback.
- `generatedAt` / `workerGeneratedAt`: when the route/Worker attached measurements.
- `responseId`: random identifier for this Worker response generation, not a user ID.
- `ageSeconds`: HTTP Age when available; absence does NOT prove a cache miss.

Only fixed numeric fields/enums and the response ID are copied. URLs, request headers,
cookies, catalog rows and response bodies are not added. Request fields are flattened
inside Sentry extra so the SDK's default normalization depth preserves the numbers.

## Interpretation limits

HTTP/preload caches can replay timings and response IDs from an older response.
Check both generation timestamps and Age first; do not treat a cached 8-second KV
measurement as evidence that the current fetch spent 8 seconds in KV. Clock skew
also makes client/server wall-clock subtraction unreliable. Intervals overlap:
do not add Worker, handler and KV durations together.

Cloudflare's production clocks advance only after I/O. A zero serialization duration
does not prove zero CPU work. See [Workers performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/).
The diagnostic header uses [Server-Timing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing).

A fresh response with a large KV interval points to the compact KV path; a large
fallback interval calls for source-specific follow-up. A small Worker interval with
a long browser wait leaves cache/preload, connection, edge/startup and browser
scheduling as candidates, not a proven network fault. A large body/parse or preparation
interval calls for browser profiling. Match the observation to the reported time,
language and environment before attributing it to a particular user incident.

## Verification and rollout

`npx playwright test --config playwright.catalog-diagnostics.config.ts` starts an
isolated local dev server on port 3517 with a localhost-only DSN, intercepts envelopes,
holds a catalog response, and checks the real 12-card -> enabled-filter -> Sentry path.
It does not send test events to production. Node tests also exercise the actual handler,
Worker header helper, loader and SDK transport together with deterministic clocks.

This changes the Worker and browser bundle. It needs reviewed merge and manual activation
before production evidence is available. After activation, inspect `catalog-slow-load`
and compare the above intervals before changing caches or adding parallel fallback fetches.
