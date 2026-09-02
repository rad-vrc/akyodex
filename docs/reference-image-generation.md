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
  `public, max-age=0, must-revalidate`. Do not weaken the 250,000/350,000-byte
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

## Rollout checklist

- [ ] Deploy the reviewed generator revision to staging using `Reference Image
  Generator` / `deploy-staging`.
- [ ] Verify the actual consumer settings and R2 notifications (correct Queue,
  create/delete actions, `.png` suffix), not just the presence of a Queue name.
- [ ] Verify generation, overwrite, deletion, and re-upload using disposable
  staging originals. Preserve the original bytes and ETag after generation.
- [ ] Merge the generator PR; deploy with `deploy-production` only after approval.
- [ ] Check current monthly Images usage and supply it to `backfill-production`.
  Do not enable paid usage automatically. Background generation may take tens
  of minutes with one consumer; enqueue success is not generation completion.
- [ ] Run `audit-production`. Require nonzero sources and zero issues, orphans,
  and incomplete originals before merging the client change. Resolve oversized
  outputs explicitly instead of changing the threshold to hide them.
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

## Recovery

For a client regression, restore the preceding healthy Web Worker version. For
a generator regression, disable its R2 notification and roll back that generator
Worker. Do not delete originals or use a data rollback. Audit failures report
keys for investigation; they never auto-delete objects or auto-enqueue repairs.
