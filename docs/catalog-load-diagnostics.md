# Catalog load diagnostics

This instruments the transition from the initial 12 cards to the complete catalog
and enabled filters. The delayed fallback below keeps API preloading, the
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

The API starts immediately with the same fetch options as its preload. If headers
have not arrived after 2,000 ms, the client also requests the existing R2 JSON.
Successful headers replace that timer with a 3,000 ms body-idle timer. Every
non-empty body chunk restarts the idle timer; empty chunks do not. A slow body
that keeps delivering chunks therefore does not compete with R2, even after six
seconds. An API HTTP/network/JSON/validation failure starts R2 immediately.
Each source starts at most once per load. Progress after R2 has already started
does not schedule another request or cancel it.

Only the API body is piped through a progress-observing TransformStream. A native
Response still performs JSON decoding, including split UTF-8 characters and BOMs.
Cancellation propagates to the stream reader as well as fetch. Progress here means
bytes delivered by the browser's decoded response stream, not raw socket bytes:
decompression/proxy/browser buffering can still hide wire-level progress.
See [Response.body](https://developer.mozilla.org/en-US/docs/Web/API/Response/body).

Only R2 uses `cache: "no-cache"`: a cached representation is revalidated, including
when the browser considers it heuristically fresh. This permits a 304 and reuse
of its body but prevents an unvalidated local cache hit from winning. API preload
and snapshot fetch options are unchanged. It does not bypass upstream CDN caches
or compare API and R2 revisions.
See the [browser Request.cache semantics](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache).

The first validated live payload claims the win synchronously before another queued
body continuation can normalize or record success. Pending work is aborted without
waiting for its rejection, and late results cannot update data or diagnostics. An R2 failure
does not cancel a pending API. The bundled snapshot is tried only after both live
sources fail, never raced against a pending live source. All attempts share one
15-second budget from the initial API start, including body reads and validation.
Caller abort stops every attempt and timer. Preparation after fetching is still
excluded from the coordinator's stalled-network detection.

This targets observed long API/header waits and body stalls, not initial HTML,
hydration, or all Web Vitals. Two/three seconds are initial engineering settings,
not measured optima. A body with delivery gaps of three seconds can still compete
with R2; this is not a guarantee of improvement on every connection. Fast API loads make no
R2 request; slow loads can transfer both responses in part. Client cancellation
does not guarantee cancellation of server work or a network request still consumed
by a preload.

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

`npx playwright test --config playwright.catalog-transport.config.ts` serves the
real loader (TypeScript transpilation only) and checked-in `public/sw.js` from local
HTTP servers. It builds the API payload in memory with the production serializer
from tracked `data/akyo-data-ja.json`; no generated `public/catalog` file or preceding
build is required. Default fixtures use Brotli quality 4, not Node's default quality
11. It tests heuristic browser caching, conditional 200/304 revalidation, and
unfinished-body cancellation with/without SW and preload. No production requests
or Sentry DSN are used by the tests. These E2Es are manual checks, not currently a
GitHub CI step.

Set `CATALOG_TRANSPORT_BENCHMARK=1` and select `manual throttled` to compare body-idle
hedging / no hedge with real Chromium throttling and five samples per condition.
Optional `CATALOG_BENCHMARK_BASE_REF` loads the prior loader from that local Git
revision (for the 6s comparison, `cdfcbf5a742702c6dd7c63e43ef68af87852e324`; that
commit must exist locally). Optional `CATALOG_BENCHMARK_API_BR` and
`CATALOG_BENCHMARK_R2_BR` accept paths to captured, still-Brotli-compressed JSON
bodies, avoiding recompression when reproducing a production transfer size. The
experiment prints the actual byte counts and validates decompression. It does not
download these fixtures itself. Timing values are observations, not CI thresholds.
The experiment does not simulate JS/images sharing the same connection.

### Production-sized transport experiment (2026-09-30)

The preceding 6s experiment used Brotli quality 11 (API 61,681 bytes; R2 66,140
bytes), which underestimated production transfer sizes. The API input was an
ignored generated snapshot, not a checked-in file. Those measurements did not
establish safety on extremely slow connections; the fixed 6s rule is superseded.

The follow-up captured public production responses at 11:43 UTC and served their
original Brotli bytes without recompression: API 81,331 bytes; R2 86,665 bytes.
Chromium 141.0.7390.37, two loopback HTTP origins, five samples per condition,
no preload, 300ms CDP latency for bandwidth-limited cases. The old 6s loader was
loaded directly from commit `cdfcbf5a`, not simulated with new-loader options.
Both hedged policies use R2 revalidation. These are local measurements starting
when the loader starts, after JS loads; not production RUM or a universal bound.

| Condition | Old fixed 6s | Body idle 3s | No hedge |
| --- | ---: | ---: | ---: |
| 56 kbps | 15,002ms (5/5 timeout) | 12,005ms | 12,006ms |
| 64 kbps | 14,632ms | 10,505ms | 10,505ms |
| 100 kbps | 7,327ms | 6,844ms | 6,844ms |
| 128 kbps | 5,443ms | 5,441ms | 5,441ms |
| 150 kbps | 4,646ms | 4,644ms | 4,644ms |
| Unthrottled, API headers held 8s | 2,012ms | 2,013ms | 8,011ms |
| Unthrottled, API body held open | 6,012ms | 3,015ms | 15,002ms (timeout) |

All five progressing transfer conditions made zero R2 requests with the idle rule
(25/25 samples). Separately, a 56 kbps load was deliberately timed out after 1s,
then retried in the same page without preload: the retry succeeded from API in
12,073ms with no R2 request. The default total deadline remains 15s; a single
transfer that cannot finish within it still fails, regardless of hedging.

With the unmodified checked-in SW, the older loader left a preload-owned API
connection open 500ms after R2 won. The idle version also cancels the body reader:
in this Chromium all four SW/preload combinations closed the held API connection
before that observation (three repetitions each). These are observations, not a
cross-browser cancellation guarantee or a promise to stop server-side processing.

This changes the Worker and browser bundle. It needs reviewed merge and manual activation
before production evidence is available. After activation, compare roughly seven days
of timeouts, slow completions and hedge/winner metadata, separated by bots and normal
browsers and by release. Fast hedge successes appear only in sampled `catalog.ready`
spans; raw issue counts are not a success rate. Zero reports alone do not prove a fix.
