import type { SupportedLanguage } from "@/lib/i18n";

export type CatalogLoadSource = "api" | "r2" | "snapshot" | "none";

interface PerformanceClock {
  readonly timeOrigin: number;
  now(): number;
  mark(name: string): void;
}

export interface CatalogLoadTelemetryEvent {
  language: SupportedLanguage;
  source: CatalogLoadSource;
  durationMs: number;
  failureReason: string | null;
  startedAtEpochMs: number;
  endedAtEpochMs: number;
}

export function getCatalogFailureReason(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

export class CatalogLoadPerformance {
  private readonly startedAt: number;
  private source: CatalogLoadSource = "none";
  private ended = false;

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
      },
    });
    span.setStatus({ code: event.failureReason ? 2 : 1 });
    span.end(new Date(event.endedAtEpochMs));
  } catch {
    // Telemetry must never affect catalog availability.
  }
}
