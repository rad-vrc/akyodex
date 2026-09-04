# Reference image generation

The Queue-only generator reads root `NNNN.png` originals and writes only
`reference/NNNN-960.webp` and `reference/NNNN-1920.webp`. Original files and the
full-resolution PNG download route are not changed. The browser never invokes
the generator. The shared, runtime-independent contract is in
`src/lib/reference-image-contract.ts`.

## Correctness constraints

- Both environments must keep `max_batch_size: 1` and `max_concurrency: 1`.
  These are correctness requirements, not throughput tuning defaults. Source
  ETag checks and derivative writes are separate R2 operations. A conditional
  write on one key cannot atomically validate a different source key. Increasing
  concurrency requires per-key serialization or another independently verified
  conflict-safe design. Config tests pin both settings; the interleaving test
  documents the corruption possible without serialization.
- Keep quality 82, fixed WebP widths 960/1920, and
  `public, max-age=0, must-revalidate`. Do not weaken the 250,000/600,000-byte
  audit budgets or silently change quality to pass an audit.
- No generator path may put or delete an original PNG. A source deletion may
  delete its two derivatives only. Staging Queue, DLQ, and R2 stay isolated from
  production; the generator has no public route or workers.dev endpoint.
- The offline audit is read-only. It checks valid sources and derivative
  metadata, missing/stale/oversized derivatives, orphan derivatives, and
  unexpected keys under `reference/`. Incomplete source metadata is reported
  separately and does not make its derivatives appear orphaned.
- Audit and backfill reject truncated/malformed listings and empty source
  inventories. AWS CLI automatic pagination must remain enabled, without
  `--max-items`. `IsTruncated: true`, a remaining `NextContinuationToken`, or a
  CLI `NextToken` means the input is not a complete inventory. `--page-size`
  alone does not truncate the final result.

## Original uploads and public storage

Upload or overwrite production originals manually at `akyo-images/NNNN.png`
using the Cloudflare dashboard or an R2 client, as before. Only root-level,
four-digit, lowercase `.png` keys are eligible. The admin registration form does
not upload these originals; no CSV edit or admin operation is needed to trigger
generation. Once configured, R2 create/delete notifications drive the generator.

The staging workflow attaches `images-staging.akyodex.com` to
`akyodex-workers-staging-data`. A custom domain exposes the bucket's objects,
not just `reference/`; public CSV/JSON and test originals are also reachable by
key unless separately restricted. Never put credentials, private data, or
non-public test fixtures in this bucket. The private Queue-only generator does
not make its storage private. Use disposable, public-safe staging originals.
See [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## Backfill budget

Before every production backfill, confirm the account's Images plan and current
calendar-month usage in the dashboard. The existing guard requires:

```text
current monthly transformations + current eligible original count * 2 <= 5,000
```

For 834 originals this is 1,668 planned transformations, so current usage must
be at most 3,332. These counts are an example, not a permanent allowance: refresh
the inventory and usage each time, and allow headroom for other image activity.
The guard is an estimate, not a reservation of remaining capacity. On retries
it still budgets two variants for every original, even when some are current;
do not bypass it or supply a lower usage value to force a run.

Images Free rejects new transformations beyond its limit with `9422` rather
than charging overages. Do not enable a paid plan automatically. Skipping an
already-current derivative saves its transformation only; missing/stale
variants and Queue, Worker, and R2 operations remain. See
[Images pricing](https://developers.cloudflare.com/images/pricing/) and
[Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

## Rollout checklist

- [ ] Deploy the reviewed generator revision to staging using `Reference Image
  Generator` / `deploy-staging`.
- [ ] Verify the actual consumer settings and R2 notifications (correct Queue,
  create/delete actions, `.png` suffix), not just the presence of a Queue name.
- [ ] Verify generation, overwrite, deletion, and re-upload using disposable
  staging originals. Preserve the original bytes and ETag after generation.
- [ ] Merge the generator PR; deploy with `deploy-production` only after approval.
- [ ] Check current monthly Images usage and supply it to `backfill-production`.
  Follow the backfill budget above. Background generation may take tens of
  minutes with one consumer; enqueue success is not generation completion.
- [ ] Run `audit-production`. Require nonzero sources and zero issues, orphans,
  and incomplete originals before merging the client change. Use the oversized
  derivative decision rule below if a size check fails.
- [ ] Update the client PR to the reviewed generator/main revision, run Full CI,
  and repeat cache-cold 0800/0826/0832 measurements and modal E2E tests.
- [ ] Only after approval, merge the client and use the normal Worker candidate
  upload and manual activate flow. Never restore Pages production.
- [ ] Enable the monthly read-only audit with repository variable
  `REFERENCE_IMAGES_ENABLED=true` after rollout.

The existing Pages preview reads public production derivatives. Before backfill
it can exercise fallbacks, not prove successful derivative delivery. Generator
correctness and real transformations must be verified in isolated Workers
staging. Standard Lighthouse only measures the list page, not modal openings.

## Oversized derivative decision rule

An output above 250,000 bytes (960px) or 600,000 bytes (1920px) remains an audit
failure even if it is a valid WebP. Before the client rollout, keep PR #467
unmerged and the current PNG display path active until the issue is resolved.
After rollout, an oversized result requires investigation, not an automatic
rollback or deletion.

Record the affected original/derivative keys, source ETag, width, actual byte
size, image validity, and cache-cold display time. Do not silently lower quality,
raise the shared limit, downgrade the failure to a warning, or exempt individual
keys. If the fixed settings cannot meet the budget, present the evidence and a
scoped proposal to the owner. Any exception or budget/quality change requires
explicit approval and a separate reviewed change to the contract and checks;
until then the failure and client rollout gate remain in place. Re-enqueueing a
current derivative does not resize it or fix a size-only audit failure.

Budget history: on 2026-09-04 the 1920px budget was raised from 350,000 to
600,000 bytes after the first production audit flagged three valid 1920x1080
outputs (`0091` 532,170 B, `0229` 509,038 B, `0777` 421,482 B; originals
5.6-6.4 MB). The 960px budget, quality 82, widths, cache policy, and
`generator-version` did not change, so no regeneration or backfill was needed.
Distribution at that time across 834 originals: 1920px p50 68,060 B, p99
191,070 B, max 532,170 B; 960px max 155,172 B. Outputs above 600,000 bytes
remain audit failures under the same rule.

## Recovery

For a client regression, restore the preceding healthy Web Worker version. For
a generator regression, disable its R2 notification and roll back that generator
Worker. Do not delete originals or use a data rollback. Audit failures report
keys for investigation; they never auto-delete objects or auto-enqueue repairs.

For Images quota exhaustion, do not repeatedly dispatch backfill while `9422`
persists. Transient generation failures request a 60-second retry delay, with
`max_retries: 5` before delivery to the DLQ. This repository has no automatic DLQ
replay action; DLQ retention is finite, so do not rely on messages surviving
until next month. See [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).

After the monthly reset, confirm available quota in the dashboard and follow
the budget check again. Run `backfill-production` with the refreshed
`current-images-transformations` value. This re-lists current originals and
enqueues them all; the generator skips variants whose source ETag, version,
width, and quality are already current and generates only missing/stale ones.
It reconstructs generation work from originals rather than replaying the DLQ.
Wait for generation to finish, then run `audit-production`; enqueue success or
an empty DLQ is not proof of recovery. Backfill does not repair orphan
derivatives from missed deletes, oversized current outputs, or every invalid
metadata case. Keep remaining audit failures visible and resolve them through
separately approved action; never delete originals or bypass the client gate.
