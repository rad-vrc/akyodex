import {
  createCatalogHttpResponse,
  extractSerializedCatalogPayload,
  serializeCatalogPayload,
} from "@/lib/catalog-payload";
import { isValidLanguage, type SupportedLanguage } from "@/lib/i18n";
import type { AkyoData } from "@/types/akyo";

interface CatalogHandlerDependencies {
  readCached(language: SupportedLanguage): Promise<string | null>;
  loadData(language: SupportedLanguage): Promise<AkyoData[]>;
}

export async function handleCatalogRequest(
  request: Request,
  languageParam: string,
  dependencies: CatalogHandlerDependencies,
): Promise<Response> {
  if (!isValidLanguage(languageParam)) {
    return Response.json(
      { error: "Unsupported catalog language" },
      { status: 400 },
    );
  }

  try {
    const cachedText = await dependencies.readCached(languageParam);
    const serialized = cachedText
      ? extractSerializedCatalogPayload(cachedText, languageParam)
      : null;
    const responsePayload =
      serialized ??
      (await serializeCatalogPayload(
        languageParam,
        await dependencies.loadData(languageParam),
      ));

    return createCatalogHttpResponse(
      responsePayload,
      request.headers.get("If-None-Match"),
    );
  } catch (error) {
    console.error("[catalog-api] Failed to serve complete catalog", {
      language: languageParam,
      error,
    });
    return Response.json(
      { error: "Complete catalog is temporarily unavailable" },
      { status: 500 },
    );
  }
}
