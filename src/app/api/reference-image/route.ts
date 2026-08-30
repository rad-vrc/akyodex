import { connection } from "next/server";

import { fetchReferenceSheetImage } from "@/lib/reference-sheet-image";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  await connection();

  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get("id") ?? "";
  const r2BaseUrl =
    process.env.NEXT_PUBLIC_R2_BASE || "https://images.akyodex.com";
  const result = await fetchReferenceSheetImage({
    id,
    ifNoneMatch: request.headers.get("If-None-Match"),
    r2BaseUrl,
  });

  if (result.failureStage && result.response.status >= 500) {
    console.warn("[reference-image] Request failed", {
      id,
      stage: result.failureStage,
      status: result.response.status,
    });
  }

  return result.response;
}
