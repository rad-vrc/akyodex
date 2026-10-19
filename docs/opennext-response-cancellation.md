# OpenNext Response Cancellation Workaround

## Why

The Cloudflare adapter in `@opennextjs/aws` 4.1.1 creates a response
`ReadableStream` without a `cancel` handler. Cancelling the HTML body can leave
the Node response and Next's render task pending. In the downloaded production
module, a controlled local cancellation reproduced the Workers "code had hung"
exception 30/30 times. Forwarding cancellation to the existing Node response
abort path reduced it to 0/30. Sentry's flush completed in the reproduced case;
bypassing its outer wrapper did not prevent the hang.

This identifies a reproducible failure path, not proof that every production
hang has that cause. The local control cancelled the returned body directly;
production client disconnects and edge behaviour still need separate validation.

## Build Integration

All three Cloudflare build scripts run
`scripts/fix-opennext-response-cancellation.js` **before** starting OpenNext.
It adds a request-local AbortController to the installed adapter, aborts it from
the response stream's `cancel`, and combines it with the original request signal.
The existing OpenNext Node response then closes and Next settles its render task.
Streaming, original request cancellation, and null-body statuses are preserved.
There is no new production logging, body buffering, Sentry configuration change,
or `enable_request_signal` flag change.

Only the exact upstream 4.1.1 file and the exact corrected file are accepted by
SHA-256. The latter makes repeated builds safe. Any other content stops the
build without modifying the file. `npm ci` restores the original dependency;
the next build reapplies the workaround. OpenNext's current config validator
requires the built-in `cloudflare-node` wrapper, so this does not disable config
validation to install a custom wrapper.

When updating OpenNext, review its adapter before changing the fingerprints.
If upstream propagates body cancellation correctly, remove this workaround and
the three build hooks after the regression tests pass against the upstream code.
Do not bypass the guard just to make an upgraded build pass.

## Verification

```sh
npx tsx --test scripts/fix-opennext-response-cancellation.test.js
```

These tests use the actual installed OpenNext Node response and Next's
`pipeToNodeResponse`, not a mock implementation of the render pipeline. They
cover immediate and mid-stream body cancellation, normal incremental HTML,
the original abort signal, request isolation, 204/205/304, repeat application,
upstream drift, and all Cloudflare build entry points.

Before activating production, verify the built revision on staging, read HTML
and catalog JSON to completion, and compare a bounded set of interrupted
requests with runtime logs. A normal HTTP 200 or a successful uptime check alone
does not validate the body or prove the cancellation issue is resolved.

Upstream: <https://github.com/opennextjs/opennextjs-aws/blob/main/packages/open-next/src/overrides/wrappers/cloudflare-node.ts>
