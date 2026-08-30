import type { SupportedLanguage } from "@/lib/i18n";

export type CatalogLoadSource = "api" | "r2" | "snapshot" | "none";

interface PerformanceClock {
  readonly timeOrigin: number;
  now(): number;
  mark(name: string): void;
  measure(name: string, startMark: string, endMark: string): unknown;
}

export type CatalogLoadPhase = "normalize" | "search-index" | "state-apply";

export interface CatalogPhaseDurations {
  normalize: number;
  searchIndex: number;
  stateApply: number;
}

export interface CatalogLoadTelemetryEvent {
  language: SupportedLanguage;
  source: CatalogLoadSource;
  durationMs: number;
  failureReason: string | null;
  startedAtEpochMs: number;
  endedAtEpochMs: number;
  phaseDurationsMs: CatalogPhaseDurations;
}

const PHASE_NAMES: Record<
  CatalogLoadPhase,
  { measure: string; start: string; end: string; duration: keyof CatalogPhaseDurations }
> = {
  normalize: {
    measure: "catalog-normalize",
    start: "catalog-normalize-start",
    end: "catalog-normalize-end",
    duration: "normalize",
  },
  "search-index": {
    measure: "catalog-search-index",
    start: "catalog-search-index-start",
    end: "catalog-search-index-end",
    duration: "searchIndex",
  },
  "state-apply": {
    measure: "catalog-state-apply",
    start: "catalog-state-apply-start",
    end: "catalog-state-apply-end",
    duration: "stateApply",
  },
};

export function getCatalogFailureReason(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

export class CatalogLoadPerformance {
  private readonly startedAt: number;
  private source: CatalogLoadSource = "none";
  private ended = false;
  private readonly phaseStartedAt = new Map<CatalogLoadPhase, number>();
  private readonly phaseDurations: CatalogPhaseDurations = {
    normalize: 0,
    searchIndex: 0,
    stateApply: 0,
  };

  constructor(
    private readonly language: SupportedLanguage,
    private readonly clock: PerformanceClock = performance,
  ) {
    this.startedAt = clock.now();
    clock.mark("catalog-fetch-start");
  }

  markResponse(source: Exclude<CatalogLoadSource, "none">): void {
    if (this.ended) return;
    this.source = source;
    this.clock.mark("catalog-response");
  }

  startPhase(phase: CatalogLoadPhase): void {
    if (this.ended || this.phaseStartedAt.has(phase)) return;
    const names = PHASE_NAMES[phase];
    this.phaseStartedAt.set(phase, this.clock.now());
    this.clock.mark(names.start);
  }

  endPhase(phase: CatalogLoadPhase): void {
    if (this.ended) return;
    const startedAt = this.phaseStartedAt.get(phase);
    if (startedAt === undefined) return;

    const names = PHASE_NAMES[phase];
    const endedAt = this.clock.now();
    this.phaseStartedAt.delete(phase);
    this.phaseDurations[names.duration] += Math.max(0, endedAt - startedAt);
    this.clock.mark(names.end);
    this.clock.measure(names.measure, names.start, names.end);
  }

  markReady(): CatalogLoadTelemetryEvent | null {
    if (this.ended) return null;
    this.clock.mark("catalog-ready");
    return this.finish(null);
  }

  markFailure(error: unknown): CatalogLoadTelemetryEvent | null {
    if (this.ended) return null;
    return this.finish(getCatalogFailureReason(error));
  }

  private finish(failureReason: string | null): CatalogLoadTelemetryEvent {
    this.ended = true;
    const endedAt = this.clock.now();
    return {
      language: this.language,
      source: this.source,
      durationMs: Math.max(0, Math.round(endedAt - this.startedAt)),
      failureReason,
      startedAtEpochMs: this.clock.timeOrigin + this.startedAt,
      endedAtEpochMs: this.clock.timeOrigin + endedAt,
      phaseDurationsMs: {
        normalize: Math.round(this.phaseDurations.normalize),
        searchIndex: Math.round(this.phaseDurations.searchIndex),
        stateApply: Math.round(this.phaseDurations.stateApply),
      },
    };
  }
}

export async function reportCatalogLoadToSentry(
  event: CatalogLoadTelemetryEvent,
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  try {
    const Sentry = await import("@sentry/nextjs");
    const span = Sentry.startInactiveSpan({
      name: "catalog.ready",
      op: "ui.load",
      forceTransaction: true,
      startTime: new Date(event.startedAtEpochMs),
      attributes: {
        "catalog.language": event.language,
        "catalog.source": event.source,
        "catalog.duration_ms": event.durationMs,
        "catalog.failure_reason": event.failureReason ?? "none",
        "catalog.normalize_ms": event.phaseDurationsMs.normalize,
        "catalog.search_index_ms": event.phaseDurationsMs.searchIndex,
        "catalog.state_apply_ms": event.phaseDurationsMs.stateApply,
      },
    });
    span.setStatus({ code: event.failureReason ? 2 : 1 });
    span.end(new Date(event.endedAtEpochMs));
  } catch {
    // Telemetry must never affect catalog availability.
  }
}
