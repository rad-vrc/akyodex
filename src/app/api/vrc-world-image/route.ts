/**
 * VRChat World Image API
 * VRChat のワールドページから OGP 画像を取得
 */

import { connection } from "next/server";
import { getApiErrorResponse, jsonError } from "@/lib/api-helpers";
import { VRCHAT_WORLD_ID_PATTERN } from "@/lib/akyo-entry";
import { fetchVRChatWorldPage } from "@/lib/vrchat-utils";
import {
  getVRChatWorldImageRequestParams,
  resolveVRChatWorldImageUrlFromHtml,
} from "@/lib/vrchat-world-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await connection();
  const { wrld, width } = getVRChatWorldImageRequestParams(request.url);

  if (!wrld) {
    return jsonError("wrld parameter is required", 400);
  }

  const cleanWrld = wrld.trim();
  if (!VRCHAT_WORLD_ID_PATTERN.test(cleanWrld)) {
    return jsonError(
      "Invalid wrld format (must be wrld_[A-Za-z0-9-]{1,64})",
      400,
    );
  }

  try {
    const html = await fetchVRChatWorldPage(cleanWrld);
    const imageUrl = resolveVRChatWorldImageUrlFromHtml(html, width);

    if (!imageUrl) {
      return jsonError("Valid image not found", 404);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const imageResponse = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "image/webp,image/png,image/*,*/*",
        },
        signal: controller.signal,
        next: { revalidate: 3600 },
      } as RequestInit);

      clearTimeout(timeoutId);

      if (!imageResponse.ok) {
        return jsonError(
          `Image fetch returned ${imageResponse.status}`,
          imageResponse.status,
        );
      }

      const imageData = await imageResponse.arrayBuffer();
      return new Response(imageData, {
        status: 200,
        headers: {
          "Content-Type":
            imageResponse.headers.get("Content-Type") || "image/webp",
          "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          "X-Image-Source": "vrchat-world-ogp",
        },
      });
    } catch (imageFetchError) {
      clearTimeout(timeoutId);
      if (
        imageFetchError instanceof Error &&
        imageFetchError.name === "AbortError"
      ) {
        return jsonError("Image fetch timeout (30 seconds)", 504);
      }
      throw imageFetchError;
    }
  } catch (error) {
    console.error("[vrc-world-image] Error:", error);
    return getApiErrorResponse(error, "Failed to fetch VRChat world image");
  }
}
