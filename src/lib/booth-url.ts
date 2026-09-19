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
 * 以前 boothUrl を持つアバターに自動で付けていた子階層。2026-09-19 に廃止し、
 * データからも消した。古い KV や手編集で残っていても、ここで落とす。
 */
const LEGACY_BOOTH_CHILD_CATEGORIES = new Set(["Booth/アバター", "Booth/Avatar", "Booth/아바타"]);

/**
 * Ensure the "Booth" category is present when boothUrl exists.
 * - "Booth" is added to every entry with a boothUrl (no sub-category; the former
 *   "Booth/アバター" child was retired because every Booth avatar carried it,
 *   so it only duplicated "Booth" in the filter)
 * - Retired Booth children are removed
 * - Categories are not duplicated if already present
 */
export function ensureBoothCategories(
  category: string,
  boothUrl: string | undefined,
): string {
  if (!boothUrl) return category;

  const cats = (category
    ? category.split(",").map((c) => c.trim()).filter(Boolean)
    : []
  ).filter((c) => !LEGACY_BOOTH_CHILD_CATEGORIES.has(c));

  if (!cats.includes("Booth")) {
    cats.push("Booth");
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
