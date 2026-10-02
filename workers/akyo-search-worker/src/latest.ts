import { selectLatestEntries } from "../../../src/lib/akyo-entry";
import { normalizeTopK } from "./search";
import { normalizeEntryType } from "./types";
import type { AkyoRecord, Env, Language, SearchResult } from "./types";

export class LatestCatalogNotReadyError extends Error {}

const MAX_LATEST_PHRASE_LENGTH = 60;

function isLatestPhrase(value: string): boolean {
  // Bound raw input before normalization and prevent adjacent optional groups
  // from redistributing arbitrarily long whitespace runs during backtracking.
  if (value.length > MAX_LATEST_PHRASE_LENGTH) return false;
  const text = value.replace(/\s+/gu, " ").trim().replace(/[?？!！。.]+$/gu, "").trim();
  // Only unqualified catalog requests: do not turn "latest blue Akyo" or a
  // named item's latest news into a different, global-catalog question.
  return /^(?:最新|新着|新しい|最も新しい|一番新しい|いちばん新しい|最近(?:追加|登録)された|最近の)(?:の)?\s*(?:akyo|アキョ|あきょ)?\s*(?:について|は|を)?\s*(?:何|どれ)?\s*(?:ですか|教えて(?:ください)?|見せて(?:ください)?|知りたい(?:です)?)?$/iu.test(text)
    || /^(?:(?:what(?:'s| is)|show me|tell me about)\s+)?(?:the\s+)?(?:latest|newest|recently added)(?:\s+akyo(?:s)?)?$/iu.test(text)
    || /^(?:최신|가장 새로운|최근 추가된)\s*(?:akyo|아쿄)?\s*(?:는|를)?\s*(?:뭐야|알려\s*줘|알려\s*주세요)?$/iu.test(text);
}

export function isLatestRequest(query: unknown, keywords: unknown): boolean {
  if (typeof query === "string" && query.trim()) return isLatestPhrase(query);
  if (!Array.isArray(keywords) || !keywords.length) return false;
  if (!keywords.every((k): k is string => typeof k === "string" && k.length <= MAX_LATEST_PHRASE_LENGTH)) return false;
  return keywords.some(isLatestPhrase)
    && keywords.every(k => isLatestPhrase(k) || /^(?:akyo|アキョ|あきょ|아쿄)$/iu.test(k.trim()));
}

export async function searchLatest(language: Language, topK: unknown, env: Env): Promise<SearchResult[]> {
  const columns = await env.DB.prepare("PRAGMA table_info(akyos)").all<{ name: string }>();
  if (!columns.results?.some(c => c.name === "urlUpdatedAt")) {
    throw new LatestCatalogNotReadyError("Latest search requires a completed catalog sync");
  }
  // Fetch only the small ordering keys, then hydrate the chosen rows. Use the
  // exact website comparator (including invalid timestamps and timezone offsets).
  const inventory = await env.DB.prepare(`SELECT id, language, urlUpdatedAt FROM akyos
    WHERE language = ? OR language = 'ja' LIMIT 10001`).bind(language)
    .all<{ id: string; language: Language; urlUpdatedAt: string | null }>();
  const rows = inventory.results ?? [];
  if (rows.length > 10_000) throw new LatestCatalogNotReadyError("Latest catalog exceeds the supported size");
  const preferred = rows.some(r => r.language === language) ? language : "ja";
  const latest = selectLatestEntries(rows.filter(r => r.language === preferred)
    .map(r => ({ ...r, urlUpdatedAt: r.urlUpdatedAt ?? undefined })), normalizeTopK(topK));
  if (!latest.length) return [];
  const result = await env.DB.prepare(`SELECT id, nickname, name, category, description, author, url, language, urlUpdatedAt
    FROM akyos WHERE id IN (${latest.map(() => "?").join(", ")}) AND language = ?`)
    .bind(...latest.map(r => r.id), preferred).all<AkyoRecord>();
  const byId = new Map((result.results ?? []).map(r => [r.id, r]));
  return latest.flatMap(({ id }) => {
    const row = byId.get(id);
    return row ? [{ ...row, entryType: normalizeEntryType(row.entryType, row.url), score: 1,
      matchType: "latest" as const, matchedField: "urlUpdatedAt", matchedKeyword: "latest" }] : [];
  });
}
