import { detectVrcEntryTypeFromUrl } from "@/lib/akyo-entry";
import type { SupportedLanguage } from "@/lib/i18n";
import { CATALOG_SCHEMA_VERSION } from "@/lib/catalog-payload";
import type { AkyoData, AkyoEntryType } from "@/types/akyo";

const DEFAULT_CATALOG_FETCH_TIMEOUT_MS = 15_000;
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;

export interface CompleteCatalogResult {
  items: AkyoData[];
  source: "api" | "r2" | "snapshot";
  droppedCount: number;
}

interface ParsedCatalogPayload {
  items: AkyoData[];
  droppedCount: number;
}

interface LoadCompleteCatalogDataOptions {
  lang: SupportedLanguage;
  catalogUrl: string;
  r2BaseUrl: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function createAbortError(): DOMException {
  return new DOMException("Catalog request was aborted", "AbortError");
}

function normalizeEntryType(value: unknown): AkyoEntryType | undefined {
  return value === "avatar" || value === "world" || value === "booth"
    ? value
    : undefined;
}

function normalizeCatalogItem(item: unknown): AkyoData | undefined {
  if (!item || typeof item !== "object") return undefined;

  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const avatarName =
    typeof raw.avatarName === "string" ? raw.avatarName.trim() : "";
  const nickname = typeof raw.nickname === "string" ? raw.nickname.trim() : "";
  const category =
    typeof raw.category === "string"
      ? raw.category
      : typeof raw.attribute === "string"
        ? raw.attribute
        : "";
  const comment =
    typeof raw.comment === "string"
      ? raw.comment
      : typeof raw.notes === "string"
        ? raw.notes
        : "";
  const author =
    typeof raw.author === "string"
      ? raw.author
      : typeof raw.creator === "string"
        ? raw.creator
        : "";
  const sourceUrl =
    typeof raw.sourceUrl === "string" && raw.sourceUrl.trim()
      ? raw.sourceUrl.trim()
      : typeof raw.avatarUrl === "string"
        ? raw.avatarUrl.trim()
        : "";
  const boothUrl =
    typeof raw.boothUrl === "string" ? raw.boothUrl.trim() : "";
  const displaySerial =
    typeof raw.displaySerial === "string" && raw.displaySerial.trim()
      ? raw.displaySerial.trim()
      : undefined;
  const categoryDetectedType = category
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "ワールド" || value === "world" || value === "월드")
    ? "world"
    : undefined;
  const entryType =
    normalizeEntryType(raw.entryType) ??
    detectVrcEntryTypeFromUrl(sourceUrl) ??
    (displaySerial?.startsWith("Booth") ? "booth" : undefined) ??
    (!sourceUrl && boothUrl ? "booth" : undefined) ??
    categoryDetectedType ??
    "avatar";

  if (!id) return undefined;
  if (entryType === "avatar" && !avatarName) return undefined;
  if (entryType !== "avatar" && !nickname) return undefined;

  const parsedCategory = Array.isArray(raw.parsedCategory)
    ? raw.parsedCategory.filter(
        (value): value is string => typeof value === "string",
      )
    : undefined;
  const parsedAuthor = Array.isArray(raw.parsedAuthor)
    ? raw.parsedAuthor.filter(
        (value): value is string => typeof value === "string",
      )
    : undefined;

  return {
    id,
    entryType,
    displaySerial,
    appearance: typeof raw.appearance === "string" ? raw.appearance : "",
    nickname,
    avatarName,
    category,
    comment,
    author,
    attribute: category,
    notes: comment,
    creator: author,
    sourceUrl,
    boothUrl: boothUrl || undefined,
    avatarUrl:
      typeof raw.avatarUrl === "string" && raw.avatarUrl.trim()
        ? raw.avatarUrl.trim()
        : sourceUrl,
    isFavorite:
      typeof raw.isFavorite === "boolean" ? raw.isFavorite : undefined,
    parsedCategory:
      parsedCategory && parsedCategory.length > 0 ? parsedCategory : undefined,
    parsedAuthor:
      parsedAuthor && parsedAuthor.length > 0 ? parsedAuthor : undefined,
  };
}

function parseCatalogPayload(payload: unknown): ParsedCatalogPayload {
  const wrappedData =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  if (!Array.isArray(wrappedData) || wrappedData.length === 0) {
    throw new Error("Catalog payload must contain a non-empty data array");
  }

  const normalizedItems = wrappedData.map(normalizeCatalogItem);
  const items = normalizedItems.filter(
    (item): item is AkyoData => item !== undefined,
  );
  const droppedCount = wrappedData.length - items.length;
  if (items.length === 0) {
    throw new Error("Catalog payload contains no valid entries");
  }

  if (droppedCount > 0) {
    console.warn(
      `[catalog-data-loader] Dropped ${droppedCount} invalid catalog entries`,
    );
  }

  return { items, droppedCount };
}

function validateVersionedCatalogPayload(
  payload: unknown,
  expectedLanguage: SupportedLanguage,
): void {
  if (!payload || typeof payload !== "object") return;
  const raw = payload as Record<string, unknown>;
  if (!("schemaVersion" in raw)) return;

  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error("Unsupported catalog schema version");
  }
  if (raw.language !== expectedLanguage) {
    throw new Error("Catalog payload language does not match the request");
  }
  if (typeof raw.revision !== "string" || !/^[a-f0-9]{64}$/.test(raw.revision)) {
    throw new Error("Catalog payload revision is invalid");
  }
  if (!Array.isArray(raw.data) || raw.count !== raw.data.length) {
    throw new Error("Catalog payload count is invalid");
  }
}

class CatalogDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Catalog deadline exceeded after ${timeoutMs}ms`);
    this.name = "CatalogDeadlineError";
  }
}

async function fetchCatalogSource(args: {
  url: string;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  expectedLanguage: SupportedLanguage;
}): Promise<ParsedCatalogPayload> {
  const { url, signal, fetchImpl, timeoutMs, expectedLanguage } = args;
  if (signal?.aborted) throw createAbortError();

  const requestController = new AbortController();
  let timedOut = false;
  const abortFromParent = () => requestController.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: requestController.signal,
    });
    if (!response.ok) {
      throw new Error(`Catalog request failed with HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    validateVersionedCatalogPayload(payload, expectedLanguage);
    return parseCatalogPayload(payload);
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (timedOut) {
      throw new CatalogDeadlineError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

export async function loadCompleteCatalogData(
  options: LoadCompleteCatalogDataOptions,
): Promise<CompleteCatalogResult> {
  const {
    lang,
    catalogUrl,
    r2BaseUrl,
    signal,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_CATALOG_FETCH_TIMEOUT_MS,
  } = options;
  const normalizedR2BaseUrl = r2BaseUrl.replace(/\/$/, "");
  const r2Url = `${normalizedR2BaseUrl}/data/akyo-data-${lang}.json`;
  const sources = [
    { source: "api" as const, url: catalogUrl },
    { source: "r2" as const, url: r2Url },
    { source: "snapshot" as const, url: `/catalog/catalog-v1-${lang}.json` },
  ];
  const deadline = Date.now() + timeoutMs;
  const errors: unknown[] = [];

  for (const source of sources) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new CatalogDeadlineError(timeoutMs);
    }

    try {
      const parsed = await fetchCatalogSource({
        url: source.url,
        signal,
        fetchImpl,
        timeoutMs: remainingMs,
        expectedLanguage: lang,
      });
      return { ...parsed, source: source.source };
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (error instanceof CatalogDeadlineError) {
        throw new CatalogDeadlineError(timeoutMs);
      }
      errors.push(error);
    }
  }

  throw new Error("All complete catalog sources failed", {
    cause: new AggregateError(errors),
  });
}

export class CatalogRequestCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return {
      generation: this.generation,
      signal: this.controller.signal,
    };
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation && !this.controller?.signal.aborted;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
  }
}
