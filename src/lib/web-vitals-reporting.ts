export interface WebVitalMetricLike {
  name: string;
  value: number;
  rating: string;
  navigationType: string;
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
