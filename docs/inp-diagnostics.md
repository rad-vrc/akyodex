# INP diagnostics

The production INP warning observed on 2026-10-07 had a 752 ms interaction but
no child spans or event phase attribution. Nearby breadcrumbs are not evidence
that a particular handler caused the delay. Catalog preparation in that trace
was short and happened much earlier.

The existing `Web Vitals degraded: INP` warning now includes up to eight
`inp_events` from Next.js `useReportWebVitals`. No additional observer, timer,
issue type, or per-click event is created. Good interactions remain distribution
metrics only. Warning extras also carry the Worker version from Server-Timing.

Each entry reports browser timestamps, event type, interaction ID and:

- `input_delay_ms`: processingStart minus startTime.
- `handler_duration_ms`: processingEnd minus processingStart.
- `presentation_delay_ms`: startTime plus duration minus processingEnd,
  clamped at zero because the browser rounds duration to 8 ms.

These are **per-event** phases, not a complete aggregate INP attribution.
Multiple entries may belong to one interaction. Do not add their durations.
Only fixed HTML tag names are retained; element text, input values, names,
IDs, classes, URLs and selectors are not reported. A removed target remains
`unknown`, so this change does not guarantee identification of a modal or button.

After release, compare poor events by Worker version and identify whether input
delay, handler work or presentation delay dominates before changing UI behavior.
Missing events do not establish that the performance problem is resolved.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming
- https://web.dev/articles/optimize-inp
