# CodeQL triage (2026-10-07)

The seven open alerts were checked against main after PR #597. Alert counts are
not a substitute for exploitability review. No alerts were dismissed and no
rules were disabled during this work.

| Alerts | Location | Disposition |
| --- | --- | --- |
| 64, 65 | `src/app/api/avatar-image/route.ts` | Use a constant log format and JSON-encoded data. The route already validates numeric IDs; the change also escapes control characters from upstream error messages. A route-level test covers failure logging and unchanged fallback behavior. |
| 60, 61, 62 | `scripts/vrchat-platforms/fetch-platforms.mjs` | Remove the separate existence check before reading the checkpoint. Only ENOENT starts an empty result; invalid JSON and other read failures still stop without overwriting the checkpoint. This is not a new guarantee against a hostile local directory or concurrent checkpoint writers. |
| 67 | `workers/akyo-search-worker/src/latest.test.ts` | This is an assertion over rendered answer text, not a production URL allow-list. Compare the entire expected URL line instead of an unanchored URL regex. |
| 66 | `scripts/ai-catalog-cloudflare.js` | Intentional catalog synchronization: public catalog records are sent to the configured Cloudflare D1/Vectorize/AI resources. The origin is hard-coded to `https://api.cloudflare.com`; account/resource path components are encoded and redirects are rejected. Tests now assert the origin and redirect policy for each of the D1, AI and Vectorize operations. No production code change is warranted solely to hide this data-flow alert. |

The default CI and scheduled security audit use different CodeQL configurations.
An alert is not confirmed fixed until its configuration has analyzed the merged
revision. The fixes above therefore do not imply that GitHub already reports
zero open alerts.
