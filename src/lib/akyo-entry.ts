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

/**
 * 内部ID（登録順の4桁連番）を数値で返す。
 *
 * displaySerial はアバターとワールドで別系列に振られるため、種別をまたいで
 * 「登録が新しい順」に並べる用途では使えない。内部IDだけが全種別で一意な
 * 登録順を持つので、最新N件モードはこちらを見る。
 */
export function getInternalIdNumber(akyo: Pick<AkyoData, "id">): number {
  return Number.parseInt(akyo.id, 10) || 0;
}

/**
 * 内部IDの新しい順に count 件を取り出す。入力は変更しない。
 */
export function selectLatestEntries<T extends Pick<AkyoData, "id">>(
  entries: T[],
  count: number,
): T[] {
  return [...entries]
    .sort((a, b) => getInternalIdNumber(b) - getInternalIdNumber(a))
    .slice(0, count);
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

// VRChat 公式サイトの詳細ページ URL の pathname。末尾のタブサフィックスは 1 つだけ
// 許容する（タブUIのアドレスバーからコピーすると /info 等が付いてくる。例:
// /home/world/wrld_xxx/info）。無効タブや多重セグメント（/info/anything, ////）
// まで通すと壊れた sourceUrl が保存されるため、非空セグメント 1 個までに制限する。
// ID はこのキャプチャからだけ取り出す。
const VRCHAT_AVATAR_PATH_PATTERN =
  /^\/home\/avatar\/(avtr_[a-z0-9-]{1,64})(?:\/[a-z0-9-]+)?\/?$/i;
const VRCHAT_WORLD_PATH_PATTERN =
  /^\/home\/world\/(wrld_[a-z0-9-]{1,64})(?:\/[a-z0-9-]+)?\/?$/i;

interface VrchatEntityUrl {
  entryType: "avatar" | "world";
  id: string;
}

/**
 * VRChat の avatar/world 詳細 URL を解析し、種別と ID を返す。
 *
 * 判定と ID 抽出を 1 か所にまとめ、ID は検証済み pathname のキャプチャからだけ取る。
 * userinfo（https://avtr_xxx@vrchat.com/...）やクエリ・ハッシュに含まれる ID らしき
 * 文字列は採用しない。キャプチャした ID は厳格パターン（小文字プレフィックス）を
 * 満たす必要があり、満たさない URL は VRChat URL と判定しない。
 */
function parseVrchatEntityUrl(url: string): VrchatEntityUrl | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }
  if (parsedUrl.hostname.toLowerCase() !== "vrchat.com") {
    return null;
  }

  const avatarMatch = VRCHAT_AVATAR_PATH_PATTERN.exec(parsedUrl.pathname);
  if (avatarMatch) {
    const id = avatarMatch[1];
    if (isValidVRChatEntityId("avatar", id)) {
      return { entryType: "avatar", id };
    }
    return null;
  }

  const worldMatch = VRCHAT_WORLD_PATH_PATTERN.exec(parsedUrl.pathname);
  if (worldMatch) {
    const id = worldMatch[1];
    if (isValidVRChatEntityId("world", id)) {
      return { entryType: "world", id };
    }
    return null;
  }

  return null;
}

export function detectVrcEntryTypeFromUrl(url: string): AkyoEntryType | null {
  return parseVrchatEntityUrl(url)?.entryType ?? null;
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

/**
 * VRChat の avatar/world URL を保存用の標準形へ正規化する。
 *
 *   https://vrchat.com/home/avatar/{avtr_id}
 *   https://vrchat.com/home/world/{wrld_id}
 *
 * 末尾スラッシュ・タブサフィックス（/info 等）・クエリ・ハッシュ・userinfo・
 * 大文字ホスト・http を落とし、検証済み pathname から取り出した ID だけを残す
 * （parseVrchatEntityUrl と同じ判定なので、受理集合は detectVrcEntryTypeFromUrl と
 * 一致する）。VRChat URL と判定できない入力（BOOTH のみ・空・不正）は trim 以外
 * 変更せず、拒否は従来の検証に委ねる。既存データの一括書き換えは行わず、
 * 新規登録・編集で通る入口だけに適用する。
 */
export function normalizeVrchatSourceUrl(url: string | undefined | null): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return trimmed;
  }

  const parsed = parseVrchatEntityUrl(trimmed);
  if (!parsed) {
    return trimmed;
  }
  return `https://vrchat.com/home/${parsed.entryType}/${parsed.id}`;
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
