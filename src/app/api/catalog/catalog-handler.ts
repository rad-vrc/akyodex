import {
  createCatalogHttpResponse,
  extractSerializedCatalogPayload,
  serializeCatalogPayload,
} from "@/lib/catalog-payload";
import { isValidLanguage, type SupportedLanguage } from "@/lib/i18n";
import type { AkyoData } from "@/types/akyo";
import { withCatalogServerTiming, type CatalogServerTiming } from "@/lib/catalog-diagnostics";

interface CatalogHandlerDependencies {
  now?: () => number;
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

  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  const timing: CatalogServerTiming = { durationsMs: {} };
  async function measure<T>(name: "catalog_kv" | "catalog_load" | "catalog_serialize", run: () => Promise<T>): Promise<T> {
    const start = now();
    try {
      return await run();
    } finally {
      timing.durationsMs[name] = now() - start;
    }
  }
  const finish = (response: Response) => {
    timing.durationsMs.catalog_handler = now() - started;
    timing.generatedAt = Date.now();
    return withCatalogServerTiming(response, timing);
  };

  try {
    const cachedText = await measure("catalog_kv", () => dependencies.readCached(languageParam));
    const serialized = cachedText
      ? extractSerializedCatalogPayload(cachedText, languageParam)
      : null;
    timing.source = serialized ? "kv-payload" : "fallback";
    let responsePayload = serialized;
    if (!responsePayload) {
      const data = await measure("catalog_load", () => dependencies.loadData(languageParam));
      responsePayload = await measure("catalog_serialize", () => serializeCatalogPayload(languageParam, data));
    }

    return finish(
      createCatalogHttpResponse(responsePayload, request.headers.get("If-None-Match")),
    );
  } catch (error) {
    console.error("[catalog-api] Failed to serve complete catalog", {
      language: languageParam,
      error,
    });
    return finish(
      Response.json({ error: "Complete catalog is temporarily unavailable" }, { status: 500 }),
    );
  }
}
