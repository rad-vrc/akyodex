# Software rendering

## Automatic decorative-effects fallback

The root layout runs one local capability probe after hydration. A 1x1 WebGL
context is requested with `failIfMajorPerformanceCaveat: true`, without drawing.
An unavailable or lost context, a blocked probe, or a known software renderer
(SwiftShader, llvmpipe, softpipe, Software Rasterizer, Microsoft Basic Render
Driver) enables `html[data-reduced-effects='true']`. The context is released
immediately. Renderer information is neither persisted nor sent as telemetry.

This does **not** read Chrome's hardware-acceleration setting. WebGL and CSS
compositing capabilities are related but not identical. WebGL can also be
disabled by policy, and private/unknown renderer information is not proof of
software rendering. An available context with an unknown renderer retains the
normal appearance. A hard reload checks again; there is no permanent device
classification or polling loop.

Reduced effects retain the static `body::before` background image, with its
existing fixed position and sizing. Only the translucent `body::after` overlay
and background blur are removed, across public and admin routes. The animated
Mini Akyo component
returns no DOM and does not start its image probe, maintenance timer or resize
listener. Content images, search, categories, editing, pending updates and modal
dialogs remain available. Existing reduced-motion handling is preserved.

Independently, `.admin-edit-scroll` uses `will-change: transform` on the single
clipped scroll container. This allows Chromium's software compositor to reuse
the table's tiles rather than rasterizing them on each scroll frame. It is not
applied to every row or card. The table, column sizing, sticky heading and pending
edit state are unchanged.

The initial server-rendered appearance remains normal until hydration completes.
This patch targets ongoing painting/compositing, not catalog download latency.
Browser GPU settings, Sentry configuration, production data and deployment are
not changed by the implementation.

## Checks

```powershell
npx tsx --test src/lib/rendering-capability.test.ts src/components/mini-akyo-bg.test.ts
npx playwright test tests/software-rendering.spec.ts --workers=1
```

The browser tests explicitly disable GPU acceleration. They check automatic
fallback and SPA navigation, the normal-effect branch using a capability fixture,
and table scrolling, sticky headings, modal placement and pending edits. All
authenticated UI fixtures reject non-read HTTP requests. Like the other UI E2E
tests, these are not currently run by GitHub CI; the capability unit tests are.

## Repeatable Local Measurement

Build and run a local production Next.js server first. Do not measure a dev build.
Keep Sentry and Dify disabled in this measurement server's environment.

```powershell
$env:NEXT_PUBLIC_SENTRY_DSN=''
$env:SENTRY_DSN=''
$env:NEXT_PUBLIC_DIFY_CHATBOT_TOKEN=''
npm ci
npm run next:build
npm run start -- --hostname 127.0.0.1 --port 3108
# In a second terminal:
npm run test:rendering-performance
```

The diagnostic requires locally installed Chrome (or `RENDER_CHANNEL=chromium`
for Playwright's bundled full Chromium). It launches a separate temporary browser
profile with `--disable-gpu`, and records its actual compositor/rasterization
status. It does not change the user's Chrome profile or settings. Only local
server URLs are accepted; the script mocks admin authentication and blocks all
non-read requests and Sentry/Dify traffic. Image/catalog GETs can still go to the
public data origins used by the local application.

Defaults are a 4800x2700 CSS viewport and device scale 0.8, corresponding to 4K at
80% zoom **with Windows display scaling at 100%**. These reproduce the pixel and
layout dimensions, not an actual click on Chrome's zoom menu. Set `RENDER_WIDTH`,
`RENDER_HEIGHT`, `RENDER_SCALE`, `RENDER_BASE_URL` or `RENDER_ROUNDS` as needed.
`RENDER_GPU=on` omits the disable flag for a separate accelerated-control run.

Three rounds alternate order, on fresh pages. `previous-effects` restores normal
decorations by overriding only the new capability probe, and sets the table's
`will-change` back to `auto`; it is a controlled simulation of the pre-fix
rendering, not a separately built checkout. Both variants use the same current
application/data, warmed fonts/images, and the same 1800px down/up gesture.

Results and screenshots go to `output/playwright/rendering/<timestamp>/`.
`RENDER_TRACE=1` also saves Chromium traces. Frame intervals are requestAnimationFrame
pacing, not an independent measurement of frames physically presented by a monitor.
`rasterMs` is the sum of RasterTask durations across worker threads during the
gesture; it can exceed wall-clock time. Do not add nested trace-event durations or
interpret these numbers as API wait times. Absolute thresholds are deliberately
not used as CI assertions.

## Initial Measured Result (PR #602, 2026-10-11)

Local production build, installed Chrome 154.0.8037.98 with GPU disabled,
4800x2700 CSS pixels / DPR 0.8. Three alternating-order rounds, using the
controlled previous-effects comparison described above. Medians of the three
rounds are shown below; these are not field-user measurements.

| Measurement | Previous effects | Current |
| --- | ---: | ---: |
| Catalog median frame interval | 49.9 ms | 16.7 ms |
| Catalog p95 frame interval | 50.1 ms | 16.8 ms |
| Editor RasterTask total per down/up scroll | 6,607.4 ms | 7.6 ms |
| Editor median frame interval | 16.7 ms | 16.7 ms |

These initial measurements used the PR #602 fallback without either background
layer. The subsequent static-background check below covers the retained image.

The editor already met the frame interval on this test machine; the improvement
is reduced raster work, not a measured FPS gain. The catalog improvement includes
removing the fixed decorative backgrounds and animated images, so its fallback
appearance intentionally differs. Content and controls remain visible.

An additional GPU-enabled Chrome control retained the normal background and all
42 animated decorations. Its catalog median frame interval was 8.3 ms in both
variants. Chromium reported GPU compositing and rasterization enabled for that
control, and disabled/software for the three software-rendering rounds.

## Retaining the Static Background (2026-10-11)

The static image is retained at the user's request. A follow-up local comparison
used the same Chrome version, software compositor, viewport and scale above.
Only the `body::before` display rule changed between the two variants; animated
Mini Akyo, the translucent overlay and backdrop blur stayed disabled in both.
Three alternating-order rounds on the PR #602 production build gave these
medians (the CSS change was injected to isolate its effect):

| Measurement | No background image | Static image retained |
| --- | ---: | ---: |
| Catalog median / p95 frame interval | 16.7 / 16.7 ms | 16.7 / 16.7 ms |
| Editor median / p95 frame interval | 16.7 / 16.8 ms | 16.7 / 16.8 ms |
| Editor RasterTask total per down/up scroll | 37.5 ms | 38.3 ms |

Each direction lasted approximately three seconds. The catalog's available
scroll range at this viewport was 367px; the editor scrolled 1800px. These are
not the initial table's identical scroll workload, so compare the two columns
within this follow-up, not its raster totals against the initial measurements.
No frame-pacing regression was observed in this test; this is not a guarantee
for every device or a field-user measurement. Background positioning and sizing
remain unchanged, and no extra layer-promotion hint was needed.

## References

- [Canvas context attributes](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)
- [Chromium software WebGL fallback](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md)
- [Renderer information and privacy restrictions](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_debug_renderer_info)
