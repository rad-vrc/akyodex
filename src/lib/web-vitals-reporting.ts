export interface WebVitalMetricLike {
  name: string;
  value: number;
  rating: string;
  navigationType: string;
}

interface InpEventDiagnostic {
  event_type: string;
  interaction_id: number;
  target_tag: string;
  start_time_ms: number;
  duration_ms: number;
  input_delay_ms: number;
  handler_duration_ms: number;
  presentation_delay_ms: number;
}

const SAFE_TARGET_TAGS = new Set([
  "button", "input", "select", "textarea", "a", "div", "span", "svg", "path", "main", "label",
]);
const SAFE_EVENT_TYPES = new Set(["click", "pointerdown", "pointerup", "keydown", "keyup", "mousedown", "mouseup", "touchstart", "touchend"]);

export function createInpDiagnostics(metric: { name: string; entries?: readonly unknown[] }):
  { inp_events: InpEventDiagnostic[] } | undefined {
  if (metric.name !== "INP" || !metric.entries) return undefined;
  const events: InpEventDiagnostic[] = [];
  // These are per-event phases, not an aggregate INP breakdown. Several events
  // can belong to one interaction. Duration is rounded by the browser to 8 ms.
  for (const raw of metric.entries.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Partial<PerformanceEventTiming> & { interactionId?: unknown };
    const { startTime, duration, processingStart, processingEnd, interactionId } = entry;
    if ((entry.entryType !== "event" && entry.entryType !== "first-input") ||
      typeof startTime !== "number" || typeof duration !== "number" ||
      typeof processingStart !== "number" || typeof processingEnd !== "number" ||
      typeof interactionId !== "number" ||
      ![startTime, duration, processingStart, processingEnd, interactionId].every(Number.isFinite) ||
      startTime < 0 || duration < 0 || processingStart < startTime || processingEnd < processingStart) continue;
    const tag = entry.target && "tagName" in entry.target && typeof entry.target.tagName === "string"
      ? entry.target.tagName.toLowerCase() : undefined;
    events.push({
      event_type: entry.name && SAFE_EVENT_TYPES.has(entry.name) ? entry.name : "other",
      interaction_id: interactionId,
      target_tag: !tag ? "unknown" : SAFE_TARGET_TAGS.has(tag) ? tag : "other",
      start_time_ms: startTime,
      duration_ms: duration,
      input_delay_ms: processingStart - startTime,
      handler_duration_ms: processingEnd - processingStart,
      presentation_delay_ms: Math.max(0, startTime + duration - processingEnd),
    });
  }
  return events.length ? { inp_events: events } : undefined;
}

export interface WebVitalReportingContext {
  language: string;
  pathname: string;
  workerVersion?: string;
}

export interface WebVitalDistribution {
  name: "web_vitals.cls" | "web_vitals.inp" | "web_vitals.lcp";
  value: number;
  unit: "millisecond" | "none";
  attributes: Record<string, string>;
}

interface ServerTimingEntryLike {
  name: string;
  description?: string;
}

export interface NavigationPerformanceLike {
  getEntriesByType(type: string): readonly unknown[];
}

const CORE_WEB_VITAL_DISTRIBUTIONS: Record<
  string,
  Pick<WebVitalDistribution, "name" | "unit">
> = {
  CLS: { name: "web_vitals.cls", unit: "none" },
  INP: { name: "web_vitals.inp", unit: "millisecond" },
  LCP: { name: "web_vitals.lcp", unit: "millisecond" },
};

export function createWebVitalDistribution(
  metric: WebVitalMetricLike,
  context: WebVitalReportingContext,
): WebVitalDistribution | null {
  const definition = CORE_WEB_VITAL_DISTRIBUTIONS[metric.name];
  if (!definition || !Number.isFinite(metric.value)) {
    return null;
  }

  const attributes: Record<string, string> = {
    language: context.language || "unknown",
    navigation_type: metric.navigationType || "unknown",
    page: context.pathname || "/",
    rating: metric.rating || "unknown",
  };
  if (context.workerVersion) {
    attributes.worker_version = context.workerVersion;
  }

  return {
    ...definition,
    value: metric.value,
    attributes,
  };
}

export function getWorkerVersionFromNavigation(
  performanceApi: NavigationPerformanceLike,
): string | undefined {
  const [navigationEntry] = performanceApi.getEntriesByType("navigation");
  if (
    !navigationEntry ||
    typeof navigationEntry !== "object" ||
    !("serverTiming" in navigationEntry) ||
    !Array.isArray(navigationEntry.serverTiming)
  ) {
    return undefined;
  }

  const serverTiming = navigationEntry.serverTiming as ServerTimingEntryLike[];
  const versionEntry = serverTiming.find(
    (entry) => entry.name === "akyodex-version",
  );
  const version = versionEntry?.description?.trim();
  return version || undefined;
}
