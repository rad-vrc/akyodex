# Snyk dependency triage (2026-09-08)

Scope: the dependency graph and configuration based on main `2301a24`.
This is an assessment of two advisories, not a claim that the entire application
or build environment is free of vulnerabilities. No Snyk ignore policy is added.

## csv-parse: CVE-2026-85063

- Snyk: `SNYK-JS-CSVPARSE-19639017`.
- Upstream: https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx
- Update the direct dependency from 6.1.0 to 7.0.2, the upstream fixed release.
- The advisory requires duplicate `__proto__` headers with `columns: true` and
  `group_columns_by_name: true`. The application's `src/lib/csv-utils.ts` uses
  array rows (`columns: false`); existing application/scripts do not enable
  grouped columns. The new security test deliberately exercises that mode.
- The upstream changelog says the 7.0.0 major bump was accidental, with no breaking
  changes. It also lists whitespace-handling changes, so compatibility was tested
  rather than assumed: https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md
- The duplicate-header regression fails with 6.1.0 and passes with 7.0.2.
- All 949 records per locale (JA/EN/KO) produce identical old/new parser results
  under the application's lenient array options, converter's strict array options,
  and trimmed/BOM-aware object-row options. No catalog data is rewritten.
- Full Node suite: 520 passed; TypeScript and knip passed locally.

## esbuild: GHSA-gv7w-rqvm-qjhr

- Snyk: `SNYK-JS-ESBUILD-17750822`.
- Upstream: https://github.com/evanw/esbuild/security/advisories/GHSA-gv7w-rqvm-qjhr
- Fix: https://github.com/evanw/esbuild/commit/9ff053e53b8eeb990f59355dbea365277ac45ee2
- This advisory concerns the **Deno distribution's binary-download path**, where
  an attacker-controlled `NPM_CONFIG_REGISTRY` can supply a binary without an
  integrity check. A vulnerable version in the dependency graph alone does not
  demonstrate that this Deno path executes.

Resolved graph and entry points, checked after a clean npm install:

| Consumer | esbuild | Resolved API |
| --- | --- | --- |
| `@opennextjs/cloudflare@1.20.3 -> @opennextjs/aws@4.1.1` | 0.25.4 | `node_modules/esbuild/lib/main.js` |
| `tsx@4.20.6` | 0.25.4 | `node_modules/esbuild/lib/main.js` |
| `wrangler@4.126.0` | 0.28.1 | `node_modules/wrangler/node_modules/esbuild/lib/main.js` |

The installed esbuild package uses `node install.js` as its postinstall script.
The production workflow uses Node/npm, and `open-next.config.ts` configures
Cloudflare, not a Deno runtime. OpenNext's build helpers import the npm `esbuild`
API. Searching the project's source, scripts and workflows found no Deno usage.
OpenNext itself supports Deno in other configurations; that does not establish
use of esbuild's Deno API in this configuration.

Assessment: **the specific Deno attack path is not used by the reviewed build**.
This does not claim old Node installers have every protection of newer releases,
or exclude other supply-chain risks. No hostile registry or executable was run.

As of this check, npm's latest `@opennextjs/cloudflare` is 1.20.6, depending on
`@opennextjs/aws@4.1.4`, which still pins esbuild 0.25.4. Do not force a cross-version
esbuild override just to clear this alert without compatibility testing.
Reassess when the build runtime, esbuild entry point or upstream advisory changes.

## Tracking and verification boundaries

- The authenticated main audit run is https://github.com/rad-vrc/akyodex/actions/runs/34207544020 .
  It found the esbuild alert; the workflow filters to high/critical, so csv-parse's
  medium alert is excluded, not resolved by that run.
- Keep issue #532 open while the update and alert disposition are reviewed. This
  document does not automatically suppress the finding or close its tracker.
- A merged csv-parse update still requires a production Worker release to update
  the running application's dependency. Local tests are not production evidence.
