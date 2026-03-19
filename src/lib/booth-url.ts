/**
 * Shared BOOTH URL validation and normalization.
 *
 * A valid BOOTH URL must:
 * - use the https: scheme
 * - have a hostname that is exactly "booth.pm" or ends with ".booth.pm"
 *
 * Returns the canonicalized URL string on success, or undefined on failure.
 */
/**
 * Ensure Booth categories are present when boothUrl exists.
 * - "Booth" is added to all entries with a boothUrl
 * - "Booth/アバター" is added only when entryType is "avatar"
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

  if (entryType === "avatar" && !cats.includes("Booth/アバター")) {
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
