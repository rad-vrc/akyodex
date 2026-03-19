/**
 * Shared BOOTH URL validation and normalization.
 *
 * A valid BOOTH URL must:
 * - use the https: scheme
 * - have a hostname that is exactly "booth.pm" or ends with ".booth.pm"
 *
 * Returns the canonicalized URL string on success, or undefined on failure.
 */
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
