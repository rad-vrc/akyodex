const DURATION_NAMES = [
  "catalog_kv", "catalog_load", "catalog_serialize", "catalog_handler", "catalog_worker",
] as const;

type DurationName = (typeof DURATION_NAMES)[number];

export interface CatalogServerTiming {
  durationsMs: Partial<Record<DurationName, number>>;
  source?: "kv-payload" | "fallback";
  generatedAt?: number;
  workerGeneratedAt?: number;
  responseId?: string;
  ageSeconds?: number;
}

export interface CatalogRequestTiming {
  source: "api" | "r2" | "snapshot";
  status: number | null;
  outcome: "success" | "error" | "timeout" | "aborted";
  headersWaitMs: number | null;
  bodyAndParseMs: number | null;
  totalMs: number;
  server: CatalogServerTiming | null;
}

/** Only our fixed, bounded fields are copied; never URLs, cookies or response bodies. */
export function readCatalogServerTiming(headers: Headers): CatalogServerTiming {
  const result: CatalogServerTiming = { durationsMs: {} };
  const timing = headers.get("Server-Timing") ?? "";
  if (timing.length > 8192) return result;
  // This intentionally parses only the simple metrics emitted below, not arbitrary descriptions.
  for (const part of timing.split(",")) {
    const duration = /^\s*(catalog_\w+);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
    if (duration && DURATION_NAMES.includes(duration[1] as DurationName)) {
      const value = Number(duration[2]);
      if (Number.isFinite(value)) result.durationsMs[duration[1] as DurationName] = value;
    }
    const description = /^\s*(catalog_\w+);desc="([A-Za-z0-9-]{1,64})"\s*$/.exec(part);
    if (!description) continue;
    const [, name, value] = description;
    if (name === "catalog_source" && (value === "kv-payload" || value === "fallback")) {
      result.source = value;
    }
    if (/^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value))) {
      if (name === "catalog_generated") result.generatedAt = Number(value);
      if (name === "catalog_worker_generated") result.workerGeneratedAt = Number(value);
    }
    if (name === "catalog_request" && /^[a-f0-9-]{36}$/.test(value)) result.responseId = value;
  }
  const age = headers.get("Age");
  if (age !== null && /^\d{1,10}$/.test(age)) result.ageSeconds = Number(age);
  return result;
}

export function withCatalogServerTiming(
  response: Response,
  timing: CatalogServerTiming,
): Response {
  const metrics = DURATION_NAMES.flatMap((name) => {
    const duration = timing.durationsMs[name];
    return duration === undefined ? [] : [`${name};dur=${Math.max(0, duration).toFixed(1)}`];
  });
  if (timing.source) metrics.push(`catalog_source;desc="${timing.source}"`);
  if (timing.generatedAt !== undefined) metrics.push(`catalog_generated;desc="${timing.generatedAt}"`);
  if (timing.workerGeneratedAt !== undefined) metrics.push(`catalog_worker_generated;desc="${timing.workerGeneratedAt}"`);
  if (timing.responseId) metrics.push(`catalog_request;desc="${timing.responseId}"`);
  const headers = new Headers(response.headers);
  headers.append("Server-Timing", metrics.join(", "));
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

/** Measure dispatch until response headers are ready, without buffering the body. */
export async function withCatalogWorkerTiming(
  request: Request,
  run: () => Response | Promise<Response>,
  now: () => number = () => performance.now(),
): Promise<Response> {
  if (request.method !== "GET" || !/^\/api\/catalog\/(ja|en|ko)\/?$/.test(new URL(request.url).pathname)) {
    return run();
  }
  const started = now();
  const response = await run();
  return withCatalogServerTiming(response, {
    durationsMs: { catalog_worker: now() - started },
    workerGeneratedAt: Date.now(),
    responseId: crypto.randomUUID(),
  });
}
