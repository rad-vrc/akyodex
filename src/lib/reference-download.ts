/**
 * 三面図ダウンロード API の応答ヘッダーと条件付き応答の判定。
 *
 * 原本 `NNNN.png` は同じ URL のまま上書きされることがあるため、24 時間の
 * ブラウザキャッシュでは差し替えが最大 1 日反映されない。ここでは毎回再検証させ、
 * 変更が無ければ 304 で本文を送らない（原寸 PNG のバイト列と添付ダウンロードの
 * 挙動は変えない）。判定の書き方は catalog-payload.ts の条件付き応答に合わせている。
 */

export const REFERENCE_DOWNLOAD_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/** 取得に失敗した応答はキャッシュさせない（一時的な 404 が居座らないようにする）。 */
export const REFERENCE_DOWNLOAD_ERROR_CACHE_CONTROL = "no-store";

export function buildReferenceDownloadFilename(id: string): string {
  return `akyo-${id}-reference.png`;
}

/** `If-None-Match` が ETag に一致するか。複数値と弱い ETag、`*` を扱う。 */
export function referenceDownloadEtagMatches(
  ifNoneMatch: string | null,
  etag: string | null,
): boolean {
  if (!ifNoneMatch || !etag) return false;
  const normalize = (value: string) => (value.startsWith("W/") ? value.slice(2) : value);
  const target = normalize(etag.trim());
  return ifNoneMatch
    .split(",")
    .map((value) => normalize(value.trim()))
    .some((value) => value === "*" || value === target);
}

export function buildReferenceDownloadHeaders(options: {
  id: string;
  etag: string | null;
  contentLength?: number;
}): Headers {
  const headers = new Headers({
    "Cache-Control": REFERENCE_DOWNLOAD_CACHE_CONTROL,
    "Content-Type": "image/png",
    "Content-Disposition": `attachment; filename="${buildReferenceDownloadFilename(options.id)}"`,
  });
  if (options.etag) {
    headers.set("ETag", options.etag);
  }
  if (typeof options.contentLength === "number") {
    headers.set("Content-Length", String(options.contentLength));
  }
  return headers;
}
