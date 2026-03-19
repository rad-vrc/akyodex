/**
 * Shared BOOTH URL validation and normalization.
 *
 * A valid BOOTH URL must:
 * - use the https: scheme
 * - have a hostname that is exactly "booth.pm" or ends with ".booth.pm"
 *
 * Returns the canonicalized URL string on success, or undefined on failure.
 */
// All localized forms of the Booth/avatar sub-category
const BOOTH_AVATAR_VARIANTS = ["Booth/アバター", "Booth/Avatar", "Booth/아바타"];

/**
 * Ensure Booth categories are present when boothUrl exists.
 * - "Booth" is added to all entries with a boothUrl
 * - A Booth/avatar sub-category is added only when entryType is "avatar"
 *   and none of the localized variants already exist.
 * Categories are not duplicated if already present.
 */
export function ensureBoothCategories(
  category: string,
  boothUrl: string | undefined,
  entryType: string | undefined,
): string {
  if (!boothUrl) return category;

  const cats = category
    ? category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  if (!cats.includes("Booth")) {
    cats.push("Booth");
  }

  if (
    entryType === "avatar" &&
    !cats.some((c) => BOOTH_AVATAR_VARIANTS.includes(c))
  ) {
    cats.push("Booth/アバター");
  }

  return cats.join(",");
}

export function validateBoothUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    if (host !== "booth.pm" && !host.endsWith(".booth.pm")) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
