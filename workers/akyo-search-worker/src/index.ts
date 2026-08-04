import { countByAuthor, countByKeyword } from "./count";
import {
  MAX_INGEST_RECORDS,
  ingestRecords,
  isAuthorizedForIngest,
} from "./ingest";
import {
  normalizeLanguage,
  normalizeSearchTerms,
  normalizeTopK,
  searchWithD1AndVectorize,
} from "./search";
import type { Env } from "./types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: CORS_HEADERS,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const terms = normalizeSearchTerms(body.query, body.keywords);
  if (terms.length === 0) {
    return jsonResponse({ error: "query or keywords parameter is required" }, 400);
  }

  const language = normalizeLanguage(body.language, terms.join(" "));
  const topK = normalizeTopK(body.topK);
  const results = await searchWithD1AndVectorize(terms, language, topK, env);

  return jsonResponse({
    query: typeof body.query === "string" ? body.query : undefined,
    keywords: Array.isArray(body.keywords) ? terms : undefined,
    language,
    results,
    count: results.length,
  });
}

async function handleCount(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const author = typeof body.author === "string" ? body.author.trim() : "";
  const language = normalizeLanguage(body.language, keyword || author);

  if (!keyword && !author) {
    return jsonResponse({ error: "keyword or author parameter is required" }, 400);
  }

  if (author) {
    const result = await countByAuthor(author, env);
    return jsonResponse({ author, count: result.count, avatars: result.avatars });
  }

  const result = await countByKeyword(keyword, language, env);
  return jsonResponse({
    keyword,
    language,
    count: result.count,
    examples: result.examples,
  });
}

async function handleInsertData(request: Request, env: Env): Promise<Response> {
  if (!env.INGEST_TOKEN) {
    return jsonResponse({ error: "INGEST_TOKEN is not configured" }, 503);
  }
  if (!isAuthorizedForIngest(request, env.INGEST_TOKEN)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await readJsonObject(request);
  if (!Array.isArray(body.records)) {
    return jsonResponse({ error: "records must be an array" }, 400);
  }
  if (body.records.length > MAX_INGEST_RECORDS) {
    return jsonResponse(
      { error: `records must contain at most ${MAX_INGEST_RECORDS} items` },
      413
    );
  }

  const result = await ingestRecords(body.records, env);
  return jsonResponse({ ok: result.failed === 0, ...result });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok" });
    }

    try {
      if (url.pathname === "/search" && request.method === "POST") {
        return await handleSearch(request, env);
      }
      if (url.pathname === "/count" && request.method === "POST") {
        return await handleCount(request, env);
      }
      if (url.pathname === "/insert-data" && request.method === "POST") {
        return await handleInsertData(request, env);
      }
    } catch (error) {
      console.error("Worker request failed", error);
      return jsonResponse({ error: errorMessage(error) }, 500);
    }

    return jsonResponse({ error: "Not Found" }, 404);
  },
};

export default worker;
