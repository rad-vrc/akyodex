# Catalog load diagnostics

This instruments the transition from the initial 12 cards to the complete catalog
and enabled filters. The delayed fallback below keeps preloading, caching, the
15-second total deadline, and the existing retry UI. Measurements
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
- `startOffsetMs`: attempt start relative to the full-catalog load start. Request
  entries are recorded in completion/cancellation order, not necessarily start order.
- `trigger`: `primary`, `delayed-hedge`, or `fallback` (after a source failed).
- `abortReason`: `superseded` (another source won), `caller` (navigation/language
  change/retry), or `deadline`. Superseded attempts are not catalog failures.
- Cancelled body reads record elapsed time up to cancellation, not a completed parse.
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

## Delayed fallback

The API starts immediately with the same fetch options as its preload. If no valid
payload has completed after 2,000 ms, the client also requests the existing R2 JSON.
Headers alone do not stop that timer. An API HTTP/network/validation failure starts
R2 immediately instead. Each source starts at most once per load.

The first validated live payload wins; pending work is aborted without waiting for
its rejection, and late results cannot update data or diagnostics. An R2 failure
does not cancel a pending API. The bundled snapshot is tried only after both live
sources fail, never raced against a pending live source. All attempts share one
15-second budget from the initial API start, including body reads and validation.
Caller abort stops every attempt and timer. Preparation after fetching is still
excluded from the coordinator's stalled-network detection.

This targets observed long API/header waits and body stalls, not initial HTML,
hydration, or all Web Vitals. Two seconds is an initial engineering setting, not a
measured optimum. Fast API loads make no R2 request; slow loads can transfer both
responses in part. Client cancellation does not guarantee cancellation of server work.

API and R2 freshness is not compared: they use different metadata and retain their
existing synchronization/cache behavior. The first valid response is not necessarily
the newest. No extra refresh overwrites it after display. Administrative CSV loading
does not use this fallback and keeps its separate deadline/error contract.

## Verification and rollout

`npx playwright test --config playwright.catalog-diagnostics.config.ts` starts an
isolated local dev server on port 3517 with a localhost-only DSN, intercepts envelopes,
controls API and R2 responses, and checks the real 12-card -> enabled-filter -> Sentry path.
It does not send test events to production. Node tests also exercise the actual handler,
Worker header helper, loader and SDK transport together with deterministic clocks.

This changes the Worker and browser bundle. It needs reviewed merge and manual activation
before production evidence is available. After activation, compare roughly seven days
of timeouts, slow completions and hedge/winner metadata, separated by bots and normal
browsers and by release. Fast hedge successes appear only in sampled `catalog.ready`
spans; raw issue counts are not a success rate. Zero reports alone do not prove a fix.
