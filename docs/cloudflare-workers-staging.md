# Cloudflare Workers staging

This document covers the shadow Workers deployment introduced before the
production cutover. Cloudflare Pages remains the production deployment and
rollback target throughout this stage.

## Architecture

- Worker: `akyodex-workers-staging`
- Domain: `staging.akyodex.com`
- Entry point: `cloudflare-worker.ts`, which delegates to the generated
  `.open-next/worker.js`
- Static assets: `.open-next/assets`
- Application data: existing `AKYO_KV` and `akyo-images` R2 bucket
- OpenNext incremental cache: regional long-lived cache backed by R2
- OpenNext tag cache: dedicated D1 database `akyodex-next-tag-cache`
- OpenNext revalidation queue: `DOQueueHandler` Durable Object
- Additional bindings: self-reference service binding, Images binding, and
  `CF_VERSION_METADATA`

The Pages build keeps its existing R2/KV/direct-queue configuration. Setting
`CLOUDFLARE_DEPLOY_TARGET=workers` selects the Workers-only D1 and Durable
Object configuration.

HTML is not stored in `caches.default` during this stage. The application still
uses request-specific CSP nonces, so sharing a cached HTML response between
requests would be unsafe. Static assets and OpenNext data caches remain cached.

## Build and validation

The complete Workers build must run on Linux. OpenNext creates dependency
symlinks that can fail on Windows without Developer Mode even when the Next.js
build itself succeeds.

```bash
npm ci
npm run build:workers
npm run check:types:workers
npm run dry-run:workers
```

The type check intentionally runs after the OpenNext build. The typed custom
entry point re-exports `.open-next/worker.js`, so a clean checkout must generate
that module before Wrangler can resolve the Durable Object and self-service
binding types deterministically. The command also supplies the tracked empty
`wrangler-types.env` file so local `.env.local` values cannot reorder or add
bindings to the generated declaration.

The `Workers Build Validation` GitHub Actions job runs these commands and keeps
the `.open-next` output as the `workers-build-output` artifact for seven days.

## Runtime secrets

Set staging secrets directly on `akyodex-workers-staging`. Do not commit values
or reuse credentials that have appeared in documentation or source history.

```bash
npx wrangler secret put ADMIN_PASSWORD_OWNER --config wrangler.workers.jsonc
npx wrangler secret put ADMIN_PASSWORD_ADMIN --config wrangler.workers.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.workers.jsonc
npx wrangler secret put GITHUB_TOKEN --config wrangler.workers.jsonc
npx wrangler secret put REVALIDATE_SECRET --config wrangler.workers.jsonc
npx wrangler secret put SENTRY_DSN --config wrangler.workers.jsonc
```

`SESSION_SECRET` and the two admin credentials should be newly generated for
staging. `GITHUB_TOKEN` must be a narrowly scoped token that can update the
repository data used by the admin workflow.

## Deploy and verify

After a successful Linux build, deploy the generated output with:

```bash
npx opennextjs-cloudflare deploy --config wrangler.workers.jsonc
```

Verify at least the following before production routing is considered:

1. `/`, `/zukan`, and `/api/catalog/ja` return successfully.
2. JA, EN, and KO render the correct totals without changing after hydration.
3. Avatar and VRChat world image transformations return AVIF/WebP and retain
   their original-image fallbacks.
4. Catalog preload is coalesced with the fetch, and catalog loading, search,
   filters, shared `?id=` links, favorites, and the detail modal work.
5. Admin login and a reversible CRUD operation work after staging secrets are
   configured.
6. Service Worker, Sentry reporting, CSP, AI UI, KV, R2, D1, and Durable Object
   logs show no regression.

## Rollback

The staging deployment does not own `akyodex.com`, so deleting its custom-domain
route or Worker cannot affect the Pages production site. The later production
cutover must keep Pages and its custom-domain configuration available for 14
days. During that period, rollback consists only of removing the Workers route
for `akyodex.com/*`, which immediately exposes the unchanged Pages deployment.
