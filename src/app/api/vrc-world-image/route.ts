/**
 * VRChat World Image API
 * VRChat のワールドページから OGP 画像を取得
 */

import { after, connection } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getApiErrorResponse, jsonError } from "@/lib/api-helpers";
import { VRCHAT_WORLD_ID_PATTERN } from "@/lib/akyo-entry";
import { fetchVRChatWorldPage } from "@/lib/vrchat-utils";
import {
  fetchVRChatWorldImageWithFallback,
  getPreferredCloudflareImageFormat,
  getVRChatWorldImageRequestParams,
  resolveVRChatWorldImageUrlFromHtml,
} from "@/lib/vrchat-world-image";
import { serveWorldThumbnail, type WorldThumbnailStore } from "@/lib/world-thumbnail-cache";

export const runtime = "nodejs";

function getThumbnailStore(): WorldThumbnailStore | null {
  try {
    // Keep refreshed thumbnails separate from registration-time image uploads.
    return getCloudflareContext().env.NEXT_INC_CACHE_R2_BUCKET ?? null;
  } catch {
    return null; // next dev/start without Cloudflare bindings still uses VRChat.
  }
}

export async function GET(request: Request) {
  await connection();
  const { wrld, width } = getVRChatWorldImageRequestParams(request.url);

  if (!wrld) {
    return noStoreError("wrld parameter is required", 400);
  }

  const cleanWrld = wrld.trim();
  if (!VRCHAT_WORLD_ID_PATTERN.test(cleanWrld)) {
    return noStoreError(
      "Invalid wrld format (must be wrld_[A-Za-z0-9-]{1,64})",
      400,
    );
  }

  const format = getPreferredCloudflareImageFormat(request.headers.get("Accept"));
  return serveWorldThumbnail({
    wrld: cleanWrld,
    width,
    format,
    store: getThumbnailStore(),
    after,
    load: async (signal) => {
      try {
        // R2 owns freshness; a refresh must not read six-hour-old page HTML.
        const html = await fetchVRChatWorldPage(cleanWrld, { signal, revalidate: 0 });
        const imageUrl = resolveVRChatWorldImageUrlFromHtml(html, width);
        if (!imageUrl) return jsonError("Valid image not found", 404);
        const { response, transformed } = await fetchVRChatWorldImageWithFallback({
          imageUrl, width, format, signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return jsonError("World image upstream request failed", response.status);
        }
        return new Response(response.body, { headers: {
          "Content-Type": response.headers.get("Content-Type") || "image/png",
          "X-Image-Transformed": String(transformed),
        } });
      } catch (error) {
        if (signal.aborted) return jsonError("World image fetch timeout", 504);
        console.error("[vrc-world-image] Error:", error);
        return getApiErrorResponse(error, "Failed to fetch VRChat world image");
      }
    },
  });
}

function noStoreError(message: string, status: number) {
  const response = jsonError(message, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
