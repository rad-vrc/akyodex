# Workers Issues trial

The application Worker enables Cloudflare Issues in staging and production.
This is a detection-only trial: existing Workers logs and both browser and
server Sentry integrations remain enabled. No Issues automation, external
agent destination, webhook, or automatic remediation is configured by this
change. The search and reference-image Workers are outside this trial.

## Configuration and rollout

- Keep `observability.issues.enabled: true` in `wrangler.workers.jsonc` and
  `wrangler.workers.production.jsonc`. A dashboard-only change can be lost at
  the next Wrangler deployment.
- Issues requires Wrangler 4.134.0 or newer; install from the committed lockfile
  with `npm ci`.
- Use the existing PR staging deployment and Linux Workers build/type checks.
  Do not add deliberate production failures to test detection.
- Production still uses the existing reviewed release flow: merge, candidate
  upload, explicitly authorized `action=activate`, then live verification.
  A candidate upload alone is not proof of production enablement.

## Check the trial

After deployment, open the Worker in the Cloudflare dashboard and inspect
Issues. Confirm enablement for the intended Worker and look for newly captured
failures. Issues does not backfill historical failures, and an empty list does
not prove end-to-end capture. Build success, config validation, and healthy HTTP
responses alone also do not prove that an occurrence was ingested.

Compare genuinely occurring issues with Sentry and existing logs before
deciding whether notifications would be useful. Worker exceptions, failed
invocations, 5xx responses, and error logs are in scope; browser-only failures,
GitHub Actions failures, and incorrect results returned successfully still
need their existing monitoring and tests.

Do not log passwords, tokens, cookies, or sensitive request bodies for this
trial. Adding an agent destination or notification is a separate decision:
review the data shared, permissions, duplicate alerts, and external costs.

To end the trial, set `observability.issues.enabled` to `false` in both configs
and deploy through the same release process; leave logs and Sentry unchanged.

As of 2026-10-02, Cloudflare documents Issues as free during open beta. Do not
assume that statement covers future pricing or third-party agent usage.

References:
- https://developers.cloudflare.com/workers/observability/issues/
- https://developers.cloudflare.com/workers/observability/issues/automations/
