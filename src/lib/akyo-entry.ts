import type { AkyoData, AkyoEntryType } from "@/types/akyo";

export const WORLD_CATEGORY_MARKERS = new Set(["ワールド", "world", "월드"]);
export const DEFAULT_WORLD_CATEGORY = "ワールド";
const MULTI_VALUE_SPLIT_PATTERN = /[、,]/;
const WORLD_DISPLAY_SERIAL_PREFIX = "World";
const AVATAR_DISPLAY_SERIAL_PREFIX = "Avatar";
export const BOOTH_DISPLAY_SERIAL_PREFIX = "Booth";
export const VRCHAT_AVATAR_ID_PATTERN = /^avtr_[A-Za-z0-9-]{1,64}$/;
export const VRCHAT_WORLD_ID_PATTERN = /^wrld_[A-Za-z0-9-]{1,64}$/;

function getCategoryTokens(akyo: AkyoData): string[] {
  const rawCategory = akyo.category || akyo.attribute || "";
  if (!rawCategory) {
    return [];
  }

  return rawCategory
    .split(MULTI_VALUE_SPLIT_PATTERN)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveEntryType(akyo: AkyoData): AkyoEntryType {
  if (akyo.entryType === "avatar" || akyo.entryType === "world" || akyo.entryType === "booth") {
    return akyo.entryType;
  }

  // displaySerialが"Booth"で始まるならBOOTH専用エントリ
  if ((akyo.displaySerial ?? "").startsWith(BOOTH_DISPLAY_SERIAL_PREFIX)) {
    return "booth";
  }

  // sourceUrl/avatarUrlがなくboothUrlがあればBOOTH専用エントリ
  const sourceUrl = akyo.sourceUrl?.trim() || akyo.avatarUrl?.trim() || "";
  if (!sourceUrl && akyo.boothUrl?.trim()) {
    return "booth";
  }

  const hasWorldCategory = getCategoryTokens(akyo).some((token) =>
    WORLD_CATEGORY_MARKERS.has(token),
  );

  return hasWorldCategory ? "world" : "avatar";
}

export function getDisplaySerial(akyo: AkyoData): string {
  return akyo.displaySerial?.trim() || akyo.id;
}

export function getDisplaySerialNumber(
  akyo: Pick<AkyoData, "displaySerial">,
): number | null {
  const serial = akyo.displaySerial?.trim();
  if (!serial) {
    return null;
  }

  const parsed = Number.parseInt(serial, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}

export function formatWorldDisplaySerial(serialNumber: number): string {
  return String(serialNumber).padStart(4, "0");
}

export function getNextWorldDisplaySerial(
  entries: Pick<AkyoData, "entryType" | "displaySerial">[],
): string {
  const maxSerial = entries.reduce((max, entry) => {
    if (entry.entryType !== "world") {
      return max;
    }

    const parsed = getDisplaySerialNumber(entry);
    return parsed && parsed > max ? parsed : max;
  }, 0);

  return formatWorldDisplaySerial(maxSerial + 1);
}

export function getPublicDisplayId(akyo: AkyoData): string {
  const serial = getDisplaySerial(akyo);
  if (serial.startsWith(BOOTH_DISPLAY_SERIAL_PREFIX)) {
    return serial;
  }
  return resolveEntryType(akyo) === "world"
    ? `${WORLD_DISPLAY_SERIAL_PREFIX}${serial}`
    : `${AVATAR_DISPLAY_SERIAL_PREFIX}${serial}`;
}

export function resolveDisplaySerialForSourceUrlChange(args: {
  currentDisplaySerial: string;
  detectedEntryType: AkyoEntryType | null;
  id: string;
  originalDisplaySerial?: string;
  originalEntryType?: AkyoEntryType;
}): string {
  const {
    currentDisplaySerial,
    detectedEntryType,
    id,
    originalDisplaySerial,
    originalEntryType,
  } = args;

  if (detectedEntryType === "avatar") {
    return id;
  }

  if (detectedEntryType === "world" && originalEntryType === "world") {
    return originalDisplaySerial?.trim() || currentDisplaySerial;
  }

  return currentDisplaySerial;
}

export function ensureWorldCategory(categories: string[]): string[] {
  const normalized = categories
    .map((category) => category.trim())
    .filter(Boolean)
    .filter((category, index, all) => all.indexOf(category) === index)
    .filter((category) => category !== DEFAULT_WORLD_CATEGORY);

  return [DEFAULT_WORLD_CATEGORY, ...normalized];
}

export function shouldResetWorldMetadata(
  previousUrl: string,
  nextUrl: string,
): boolean {
  const previousType = detectVrcEntryTypeFromUrl(previousUrl);
  const nextType = detectVrcEntryTypeFromUrl(nextUrl);
  if (nextType !== "world") {
    return false;
  }
  return previousUrl.trim() !== nextUrl.trim() || previousType !== "world";
}

export function resolveDisplaySerialForEntryUpdate(args: {
  entryType: AkyoEntryType;
  id: string;
  nextWorldDisplaySerial: string;
  currentDisplaySerial?: string;
  originalDisplaySerial?: string;
  originalEntryType?: AkyoEntryType;
}): string {
  const {
    entryType,
    id,
    nextWorldDisplaySerial,
    currentDisplaySerial,
    originalDisplaySerial,
    originalEntryType,
  } = args;

  if (entryType === "avatar") {
    return currentDisplaySerial?.trim() || id;
  }

  if (originalEntryType === "world") {
    return (
      originalDisplaySerial?.trim() ||
      currentDisplaySerial?.trim() ||
      nextWorldDisplaySerial
    );
  }

  const normalizedCurrentDisplaySerial = currentDisplaySerial?.trim() || "";
  if (normalizedCurrentDisplaySerial && normalizedCurrentDisplaySerial !== id) {
    return normalizedCurrentDisplaySerial;
  }

  return nextWorldDisplaySerial;
}

export function getAkyoSourceUrl(
  akyo: Pick<AkyoData, "sourceUrl" | "avatarUrl">,
): string {
  const sourceUrl = akyo.sourceUrl?.trim();
  if (sourceUrl) {
    return sourceUrl;
  }

  return akyo.avatarUrl?.trim() || "";
}

export function formatDisplayId(akyo: AkyoData): string {
  return `#${getPublicDisplayId(akyo)}`;
}

export function hydrateAkyoDataset(entries: AkyoData[]): AkyoData[] {
  const usedWorldSerials = new Set<number>();
  for (const entry of entries) {
    if (resolveEntryType(entry) !== "world") {
      continue;
    }
    const parsed = Number.parseInt(entry.displaySerial?.trim() || "", 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      usedWorldSerials.add(parsed);
    }
  }

  let nextFallbackWorldSerial = 1;
  const allocateWorldFallbackSerial = () => {
    while (usedWorldSerials.has(nextFallbackWorldSerial)) {
      nextFallbackWorldSerial += 1;
    }
    const serial = nextFallbackWorldSerial;
    usedWorldSerials.add(serial);
    nextFallbackWorldSerial += 1;
    return String(serial).padStart(4, "0");
  };

  return entries.map((entry) => {
    const entryType = resolveEntryType(entry);
    const sourceUrl = getAkyoSourceUrl(entry);
    const rawDisplaySerial = entry.displaySerial?.trim() || "";

    return {
      ...entry,
      entryType,
      sourceUrl,
      displaySerial: (() => {
        if (rawDisplaySerial.startsWith(BOOTH_DISPLAY_SERIAL_PREFIX)) {
          return rawDisplaySerial;
        }

        if (entryType !== "world") {
          return rawDisplaySerial || entry.id;
        }

        const parsed = Number.parseInt(rawDisplaySerial, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          return String(parsed).padStart(4, "0");
        }

        return allocateWorldFallbackSerial();
      })(),
    };
  });
}

export function detectVrcEntryTypeFromUrl(url: string): AkyoEntryType | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const normalizedHost = parsedUrl.hostname.toLowerCase();
    const normalizedPath = parsedUrl.pathname.toLowerCase();

    if (
      (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") &&
      normalizedHost === "vrchat.com"
    ) {
      if (/^\/home\/avatar\/avtr_[a-z0-9-]{1,64}\/?$/i.test(normalizedPath)) {
        return "avatar";
      }

      if (/^\/home\/world\/wrld_[a-z0-9-]{1,64}\/?$/i.test(normalizedPath)) {
        return "world";
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function extractVRChatAvatarIdFromUrl(
  url: string | undefined,
): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(
    /(?:^|[^A-Za-z0-9_-])(avtr_[A-Za-z0-9-]{1,64})(?=$|[^A-Za-z0-9-])/,
  );
  return match ? match[1] : null;
}

export function extractVRChatWorldIdFromUrl(
  url: string | undefined,
): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(
    /(?:^|[^A-Za-z0-9_-])(wrld_[A-Za-z0-9-]{1,64})(?=$|[^A-Za-z0-9-])/,
  );
  return match ? match[1] : null;
}

export function isValidVRChatEntityId(
  entryType: AkyoEntryType,
  id: string | undefined,
): id is string {
  if (!id) {
    return false;
  }

  const trimmedId = id.trim();
  const pattern =
    entryType === "avatar" ? VRCHAT_AVATAR_ID_PATTERN : VRCHAT_WORLD_ID_PATTERN;

  return pattern.test(trimmedId);
}
