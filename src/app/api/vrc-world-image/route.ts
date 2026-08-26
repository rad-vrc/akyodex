/**
 * VRChat World Image API
 * VRChat のワールドページから OGP 画像を取得
 */

import { connection } from "next/server";
import { getApiErrorResponse, jsonError } from "@/lib/api-helpers";
import { VRCHAT_WORLD_ID_PATTERN } from "@/lib/akyo-entry";
import { fetchVRChatWorldPage } from "@/lib/vrchat-utils";
import {
  fetchVRChatWorldImageWithFallback,
  getPreferredCloudflareImageFormat,
  getVRChatWorldImageRequestParams,
  getVRChatWorldImageResponseHeaders,
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

    try {
      const format = getPreferredCloudflareImageFormat(
        request.headers.get("Accept"),
      );
      const { response: imageResponse, transformed } =
        await fetchVRChatWorldImageWithFallback({
          imageUrl,
          width,
          format,
        });

      if (!imageResponse.ok) {
        return jsonError(
          `Image fetch returned ${imageResponse.status}`,
          imageResponse.status,
        );
      }

      const imageData = await imageResponse.arrayBuffer();
      const responseHeaders = getVRChatWorldImageResponseHeaders(
        imageResponse.headers.get("Content-Type") || "image/png",
      );
      responseHeaders.set("X-Image-Transformed", String(transformed));
      return new Response(imageData, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (imageFetchError) {
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
