import { handleCatalogRequest } from "../catalog-handler";
import { getAkyoData } from "@/lib/akyo-data";
import { getCatalogPayloadFromKVOnly } from "@/lib/akyo-data-kv";

interface CatalogRouteContext {
  params: Promise<{ lang: string }>;
}

export async function GET(
  request: Request,
  context: CatalogRouteContext,
): Promise<Response> {
  const { lang } = await context.params;
  return handleCatalogRequest(request, lang, {
    readCached: getCatalogPayloadFromKVOnly,
    loadData: getAkyoData,
  });
}
