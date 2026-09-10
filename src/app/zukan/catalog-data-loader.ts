import { detectVrcEntryTypeFromUrl } from "@/lib/akyo-entry";
import type { SupportedLanguage } from "@/lib/i18n";
import { CATALOG_SCHEMA_VERSION } from "@/lib/catalog-payload";
import type { AkyoData, AkyoEntryType } from "@/types/akyo";
import type { CatalogLoadPhase } from "./catalog-performance";

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
  phaseRecorder?: {
    startPhase(phase: CatalogLoadPhase): void;
    endPhase(phase: CatalogLoadPhase): void;
  };
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
  phaseRecorder?: LoadCompleteCatalogDataOptions["phaseRecorder"];
}): Promise<ParsedCatalogPayload> {
  const {
    url,
    signal,
    fetchImpl,
    timeoutMs,
    expectedLanguage,
    phaseRecorder,
  } = args;
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
    phaseRecorder?.startPhase("normalize");
    try {
      validateVersionedCatalogPayload(payload, expectedLanguage);
      return parseCatalogPayload(payload);
    } finally {
      phaseRecorder?.endPhase("normalize");
    }
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

/**
 * 管理画面の再取得は、遅れる公開カタログではなく保存先の CSV スナップショットを読む。
 * 遅延と削除を区別できるようにするため（/api/admin/catalog）。
 *
 * 失敗は必ず例外にする。呼び出し側は現在の一覧と保留を保ったまま、失敗を表示すること。
 * 公開カタログへ黙って落とさない。落とすと区別できない状態に戻る。
 */
export async function loadAdminCsvCatalog(
  signal?: AbortSignal,
): Promise<{ head: string; rows: AkyoData[] }> {
  const response = await fetch(`/api/admin/catalog?refresh=${Date.now()}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Administrative catalog HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" || payload === null ||
    (payload as { success?: unknown }).success !== true ||
    typeof (payload as { head?: unknown }).head !== "string" ||
    typeof (payload as { count?: unknown }).count !== "number" ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new Error("Invalid administrative catalog");
  }
  const { head, count, data } = payload as { head: string; count: number; data: AkyoData[] };
  // count は数えた件数。data と食い違うなら応答が途中で欠けているので、部分的な一覧を
  // 完全なスナップショットとして扱わない。ID が空の行も同じ理由で拒む
  if (
    data.length === 0 || count !== data.length ||
    data.some((row) => !row?.id) ||
    new Set(data.map((row) => row.id)).size !== data.length
  ) {
    throw new Error("Invalid administrative catalog");
  }
  return { head, rows: data };
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
    phaseRecorder,
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
        phaseRecorder,
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

/**
 * ネットワーク段階が「止まっている」と見なすまでの時間。締切
 * （`DEFAULT_CATALOG_FETCH_TIMEOUT_MS`）より長めに取り、正常に遅いだけの取得を
 * 取り直しで潰さない。取得後の準備段階はこの時間で測らない
 * （`CatalogRequestCoordinator.markFetched`）
 */
export const CATALOG_STALL_AFTER_MS = DEFAULT_CATALOG_FETCH_TIMEOUT_MS + 5_000;

export class CatalogRequestCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;
  private inFlight = false;
  private fetched = false;
  private startedAtMs = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    this.inFlight = true;
    this.fetched = false;
    this.startedAtMs = this.now();
    return {
      generation: this.generation,
      signal: this.controller.signal,
    };
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation && !this.controller?.signal.aborted;
  }

  /**
   * ネットワークが終わったことを記録し、ここから先を取り直しの対象から外す。
   *
   * 取得の後には検索インデックスの構築（`prepareCatalogItemsInChunks`）が続く。この段階は
   * ネットワークを待たず、ページの実行が再開すれば必ず進むので、取り直しても速くならない。
   * にもかかわらず経過時間で測ると、隠れたタブでチャンクごとの譲り渡しが引き伸ばされたり
   * ページが凍結されたりしただけで「止まっている」と判定され、ダウンロード済みの
   * カタログを捨てて取り直してしまう。
   *
   * 準備が失敗すれば `finally` が決着を記録するので、そこから先は従来どおり
   * エラー表示と再試行に進む
   */
  markFetched(generation: number): void {
    if (generation === this.generation) {
      this.fetched = true;
    }
  }

  /**
   * 取得が決着したことを記録する。現行の取得のときだけ「進行中」を下ろすので、
   * 追い越された古い取得が後続の在庫を消すことはない
   */
  settle(generation: number): void {
    if (generation === this.generation) {
      this.inFlight = false;
    }
  }

  /**
   * ネットワークを取り直してよいか。進行中の取得が無い場合と、締切を過ぎてもネットワークが
   * 終わっていない場合に真。中断されたまま後続が始まっていない状態も前者に入る
   * （`cancel` が在庫を下ろすため）。取得後の準備中は偽で、進行中の準備を潰さない
   */
  isStalled(stallAfterMs: number = CATALOG_STALL_AFTER_MS): boolean {
    if (!this.inFlight) return true;
    if (this.fetched) return false;
    return this.now() - this.startedAtMs >= stallAfterMs;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
    this.inFlight = false;
    this.fetched = false;
  }
}
