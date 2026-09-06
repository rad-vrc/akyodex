import type { SupportedLanguage } from "@/lib/i18n";
import {
  captureExceptionSafely,
  captureMessageSafely,
} from "@/lib/sentry-browser";
import type { CatalogResumeTrigger } from "./catalog-resume";
import { startInactiveSpan } from "@sentry/nextjs";

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

/**
 * 取得元を全部試し切った失敗は `AggregateError` を cause に持つ（`catalog-data-loader.ts`）。
 * Sentry は cause の中身をそのままでは見せないので、どの取得元がどう失敗したかを 1 行に畳む。
 * これが無いと「全部失敗した」しか残らず、次に起きたとき原因を絞れない
 */
export function describeCatalogFailureCause(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof AggregateError)) return undefined;

  const described = cause.errors.map((entry) =>
    entry instanceof Error
      ? redactUrls(`${entry.name}: ${entry.message}`)
      : entry === null || entry === undefined
        ? String(entry)
        : entry.constructor?.name ?? "UnknownError",
  );
  return described.length > 0 ? described.join(" | ") : undefined;
}

/** 取得元の URL は診断に要らないので落とす。既存の telemetry と同じ扱いに揃える */
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "[url]");
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

/**
 * カタログ取得の失敗を Sentry の Issue として送る。
 *
 * `reportCatalogLoadToSentry` の span は `tracesSampleRate` に従うため、既定の 0.1 では
 * 失敗の約 9 割が捨てられ、Issue にも一切現れない。障害の調査で「Sentry に出ていない」が
 * 何の証拠にもならなくなるので、失敗だけはサンプリングを通さずに送る
 */
export function captureCatalogFailure(
  error: unknown,
  context: {
    language: SupportedLanguage;
    telemetry?: CatalogLoadTelemetryEvent | null;
  },
): void {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  captureExceptionSafely(normalizedError, {
    level: "error",
    tags: {
      area: "catalog",
      language: context.language,
      failure_reason: getCatalogFailureReason(error),
    },
    extra: {
      source: context.telemetry?.source ?? "none",
      durationMs: context.telemetry?.durationMs,
      cause: describeCatalogFailureCause(error),
    },
  });
}

const CATALOG_RESUME_MESSAGE = "Catalog load resumed after a stall";

/**
 * 自動復帰の記録をまとめる fingerprint。文言は毎回変えるので、これが無いと 1 件ずつ
 * 別の Issue になってしまう
 */
export const CATALOG_RESUME_FINGERPRINT = "catalog-resume";

/**
 * 記録の文言。回数と合図を混ぜて、毎回違う文字列にする。
 *
 * 既定で有効な Sentry の `Dedupe` は、直前のイベントと「文言・fingerprint・スタックが同じ」
 * なら送信前に捨てる。タグの違いは見ないので、文言を固定すると 2 件目以降が消え、
 * 件数も合図の内訳も数えられなくなる（この記録を入れた目的そのものが成り立たない）。
 * 有効期限も無いため、アプリ側の 30 秒間隔では避けられない
 */
export function buildCatalogResumeMessage(
  count: number,
  trigger: CatalogResumeTrigger["type"],
): string {
  return `${CATALOG_RESUME_MESSAGE} (#${count}, ${trigger})`;
}

/** このページ表示で自動復帰した回数 */
let catalogResumeCount = 0;

/**
 * 止まった取得を自動で取り直したことを記録する。
 *
 * この復帰は、実ブラウザで再現できなかった「フィルターがスピナーのまま戻らない」症状に
 * 対する保険として入っている（`catalog-resume.ts`）。発火を残さないと、本番で一度でも
 * 効いたのか、それとも余計に発火しているのかを後から確かめる手立てが無く、保険を
 * 続ける判断も外す判断もできない。失敗ではないので level は info
 */
export function captureCatalogResume(
  context: {
    language: SupportedLanguage;
    trigger: CatalogResumeTrigger["type"];
  },
  capture: typeof captureMessageSafely = captureMessageSafely,
): void {
  catalogResumeCount += 1;
  capture(buildCatalogResumeMessage(catalogResumeCount, context.trigger), {
    level: "info",
    fingerprint: [CATALOG_RESUME_FINGERPRINT],
    tags: {
      area: "catalog",
      language: context.language,
      resume_trigger: context.trigger,
    },
    extra: { resumeCount: catalogResumeCount },
  });
}

export async function reportCatalogLoadToSentry(
  event: CatalogLoadTelemetryEvent,
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  try {
    // 初期化済みクライアントの span API（tracing の読み込み前でも root span として送れる）。
    // barrel の動的 import は tree-shaking されず Replay/Feedback まで別チャンクで読み込むので、
    // 静的な名前付き import にする（core は初期バンドルに既にある）。import 先を @sentry/nextjs に
    // するのはサーバ側の依存グラフを main と同じに保つため（sentry-browser.ts の注記参照）
    const span = startInactiveSpan({
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
