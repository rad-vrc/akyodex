import { getAkyoSourceUrl, resolveEntryType } from "@/lib/akyo-entry";
import type { SupportedLanguage } from "@/lib/i18n";
import type { AkyoData, AkyoEntryType } from "@/types/akyo";

export const CATALOG_SCHEMA_VERSION = 1 as const;
export const CATALOG_CACHE_CONTROL =
  "public, max-age=60, s-maxage=240, stale-while-revalidate=60";

export interface CatalogRecordV1 {
  id: string;
  entryType?: AkyoEntryType;
  displaySerial?: string;
  nickname: string;
  avatarName: string;
  category: string;
  comment: string;
  author: string;
  sourceUrl?: string;
  avatarUrl?: string;
  boothUrl?: string;
}

export interface CatalogPayloadV1 {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  language: SupportedLanguage;
  revision: string;
  count: number;
  data: CatalogRecordV1[];
}

export interface SerializedCatalogPayload {
  text: string;
  revision: string;
}

interface CatalogKVWriter {
  put(key: string, value: string): Promise<void>;
}

const CATALOG_KV_KEY_MAP: Record<SupportedLanguage, string> = {
  ja: "catalog:v1:ja",
  en: "catalog:v1:en",
  ko: "catalog:v1:ko",
};

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function toCatalogRecord(item: AkyoData): CatalogRecordV1 | undefined {
  const id = item.id.trim();
  const entryType = resolveEntryType(item);
  const nickname = item.nickname.trim();
  const avatarName = item.avatarName.trim();

  if (!id) return undefined;
  if (entryType === "avatar" && !avatarName) return undefined;
  if (entryType !== "avatar" && !nickname) return undefined;

  const sourceUrl = optionalString(getAkyoSourceUrl(item));
  const displaySerial = optionalString(item.displaySerial);
  const legacyAvatarUrl = optionalString(item.avatarUrl);
  const avatarUrl =
    legacyAvatarUrl && legacyAvatarUrl !== sourceUrl
      ? legacyAvatarUrl
      : undefined;

  return {
    id,
    entryType,
    ...(displaySerial && displaySerial !== id
      ? { displaySerial }
      : {}),
    nickname,
    avatarName,
    category: item.category || item.attribute || "",
    comment: item.comment || item.notes || "",
    author: item.author || item.creator || "",
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(optionalString(item.boothUrl)
      ? { boothUrl: optionalString(item.boothUrl) }
      : {}),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createCatalogPayload(
  language: SupportedLanguage,
  items: readonly AkyoData[],
): Promise<CatalogPayloadV1> {
  const data = items
    .map(toCatalogRecord)
    .filter((item): item is CatalogRecordV1 => item !== undefined);
  const droppedCount = items.length - data.length;
  if (data.length === 0) {
    throw new Error("Catalog payload contains no valid entries");
  }
  if (droppedCount > 0) {
    console.warn(
      `[catalog-payload] Dropped ${droppedCount} invalid catalog entries`,
    );
  }

  const revisionSource = JSON.stringify({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    language,
    count: data.length,
    data,
  });
  const revision = await sha256Hex(revisionSource);

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    language,
    revision,
    count: data.length,
    data,
  };
}

export async function serializeCatalogPayload(
  language: SupportedLanguage,
  items: readonly AkyoData[],
): Promise<SerializedCatalogPayload> {
  const payload = await createCatalogPayload(language, items);
  return {
    text: JSON.stringify(payload),
    revision: payload.revision,
  };
}

export function extractSerializedCatalogPayload(
  text: string,
  expectedLanguage: SupportedLanguage,
): SerializedCatalogPayload | null {
  const match = text.match(
    /^\{"schemaVersion":1,"language":"(ja|en|ko)","revision":"([a-f0-9]{64})","count":\d+,"data":\[/,
  );
  if (!match || match[1] !== expectedLanguage || !match[2]) {
    return null;
  }
  return { text, revision: match[2] };
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

export function createCatalogHttpResponse(
  serialized: SerializedCatalogPayload,
  ifNoneMatch: string | null = null,
): Response {
  const etag = `"${serialized.revision}"`;
  const headers = new Headers({
    "Cache-Control": CATALOG_CACHE_CONTROL,
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
  });

  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(serialized.text, { status: 200, headers });
}

export function getCatalogKVKey(language: SupportedLanguage): string {
  return CATALOG_KV_KEY_MAP[language];
}

export async function writeCatalogPayloadToKV(
  kv: CatalogKVWriter,
  language: SupportedLanguage,
  text: string,
): Promise<void> {
  await kv.put(getCatalogKVKey(language), text);
}
