import type {
  AkyoRecord,
  EntryType,
  Env,
  Language,
  SearchResult,
  VectorizeIndex,
  VectorizeMetadata,
} from "./types";
import { normalizeEntryType } from "./types";
import { createSubstringMatch } from "./sql-matching";
import { embedBudgeted } from "./budgeted-ai";
import { BudgetStoppedError } from "../../../scripts/ai-budget.js";

export { escapeLikePattern } from "./sql-matching";

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 8;
export const MAX_KEYWORDS = 3;

const MIN_SEMANTIC_SCORE = 0.35;
const MAX_KEYWORD_CANDIDATES = 24;
const GENERIC_SEARCH_TERMS = new Set([
  "akyo",
  "アバター",
  "キャラクター",
  "avatar",
  "character",
  "아바타",
  "캐릭터",
]);
const DESCRIPTIVE_AKYO_MODIFIERS = new Set([
  "cute",
  "cool",
  "pretty",
  "funny",
  "scary",
  "small",
  "big",
  "かわいい",
  "可愛い",
  "かっこいい",
  "面白い",
  "怖い",
  "小さい",
  "大きい",
  "귀여운",
  "멋진",
  "예쁜",
  "재미있는",
  "무서운",
  "작은",
  "큰",
]);

interface SearchRow extends Omit<AkyoRecord, "entryType"> {
  entryType?: EntryType;
  match_score: number;
  matched_field: string;
}

export function normalizeTopK(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TOP_K;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), MAX_TOP_K);
}

export function isJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
}

export function isKorean(text: string): boolean {
  return /[\uac00-\ud7af]/u.test(text);
}

export function detectLanguage(text: string): Language {
  if (isJapanese(text)) {
    return "ja";
  }
  if (isKorean(text)) {
    return "ko";
  }
  return "en";
}

export function normalizeLanguage(value: unknown, text: string): Language {
  if (value === "ja" || value === "en" || value === "ko") {
    return value;
  }
  return detectLanguage(text);
}

export function cleanNaturalLanguageQuery(value: string): string {
  let cleaned = value.trim().replace(/[?？!！。]+$/gu, "").trim();

  cleaned = cleaned
    .replace(
      /(?:について|を)?(?:教えて(?:ください)?|知りたい(?:です)?|説明して(?:ください)?)$/u,
      ""
    )
    .replace(/とは$/u, "")
    .replace(/^(?:tell me about|what is|who is)\s+/iu, "")
    .replace(
      /(?:에\s*대해\s*)?(?:알려\s*줘|알려\s*주세요|설명해\s*줘|설명해\s*주세요)$/u,
      ""
    )
    .trim();

  return cleaned;
}

function isDescriptiveAkyoQuery(value: string): boolean {
  const match = value.match(/^(.*?)\s*akyo$/iu);
  if (!match) {
    return false;
  }

  return DESCRIPTIVE_AKYO_MODIFIERS.has(match[1].trim().toLowerCase());
}

export function allowsDiscoveryOnNameMiss(value: unknown): boolean {
  // Match all three request suffixes stripped above. "Xを..." can describe a
  // feature; "Xについて..." must not substitute a semantic guess. Public
  // numbers are resolved by the handler before entering name/discovery search.
  return typeof value === "string" && value.length <= 200
    && /を(?:教えて(?:ください)?|知りたい(?:です)?|説明して(?:ください)?)[?？!！。]*$/u.test(value.trim());
}

export function isSpecificNameQuery(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const candidate = cleanNaturalLanguageQuery(value);
  if (!candidate || GENERIC_SEARCH_TERMS.has(candidate.toLowerCase())) {
    return false;
  }

  if (/akyo$/iu.test(candidate)) {
    return !isDescriptiveAkyoQuery(candidate);
  }

  return /^akyo(?:[_-][\p{L}\p{N}]|[\p{L}\p{N}])[\p{L}\p{N}_-]*$/iu.test(
    candidate
  );
}

export function exactCandidates(value: string): string[] {
  const original = value.trim().replace(/[?？!！。]+$/gu, "").trim();
  const cleaned = cleanNaturalLanguageQuery(value);
  const candidates: string[] = [];

  for (const candidate of [cleaned, original]) {
    if (candidate && !candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function normalizeSearchTerms(
  query: unknown,
  keywords: unknown
): string[] {
  const values = Array.isArray(keywords) && keywords.length > 0
    ? keywords
    : [query ?? keywords];
  const terms: string[] = [];

  for (const value of values.slice(0, MAX_KEYWORD_CANDIDATES)) {
    if (typeof value !== "string") {
      continue;
    }
    const cleaned = cleanNaturalLanguageQuery(value) || value.trim();
    if (!cleaned) {
      continue;
    }
    if (!terms.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      terms.push(cleaned);
    }
  }

  if (terms.length === 0 && Array.isArray(keywords) && typeof query === "string") {
    const fallback = cleanNaturalLanguageQuery(query) || query.trim();
    if (fallback) {
      terms.push(fallback);
    }
  }

  return prioritizeSpecificTerms(terms).slice(0, MAX_KEYWORDS);
}

function prioritizeSpecificTerms(terms: string[]): string[] {
  const specificTerms = terms.filter(
    (term) => !GENERIC_SEARCH_TERMS.has(term.toLowerCase())
  );

  return specificTerms.length > 0 ? specificTerms : terms;
}

export function selectVectorIndex(env: Env): VectorizeIndex {
  // The production JA/EN indexes are currently empty. Keep using the populated
  // shared index until a verified language-index backfill has completed.
  return env.VECTORIZE;
}

function toSearchResult(row: SearchRow, keyword: string): SearchResult {
  return {
    id: row.id,
    entryType: normalizeEntryType(row.entryType, row.url),
    nickname: row.nickname,
    name: row.name,
    category: row.category,
    description: row.description,
    author: row.author,
    url: row.url,
    language: row.language,
    score: row.match_score,
    matchType: row.match_score >= 0.98 ? "exact" : "partial",
    matchedField: row.matched_field,
    matchedKeyword: keyword,
  };
}

async function findExactMatches(
  candidate: string,
  language: Language,
  limit: number,
  env: Env
): Promise<SearchResult[]> {
  const result = await env.DB.prepare(`
    SELECT id, nickname, name, category, description, author, url, language,
      CASE
        WHEN nickname = ? COLLATE NOCASE THEN 0.99
        ELSE 0.98
      END AS match_score,
      CASE
        WHEN nickname = ? COLLATE NOCASE THEN 'nickname'
        ELSE 'name'
      END AS matched_field
    FROM akyos
    WHERE
      nickname = ? COLLATE NOCASE OR name = ? COLLATE NOCASE
    ORDER BY
      match_score DESC,
      CASE
        WHEN language = ? THEN 0
        WHEN language = 'ja' THEN 1
        ELSE 2
      END,
      id ASC
    LIMIT ?
  `)
    .bind(
      candidate,
      candidate,
      candidate,
      candidate,
      language,
      limit
    )
    .all<SearchRow>();

  return (result.results ?? []).map((row) => toSearchResult(row, candidate));
}

async function findPartialMatches(
  keyword: string,
  language: Language,
  limit: number,
  env: Env
): Promise<SearchResult[]> {
  const { sql: contains, parameter } = createSubstringMatch(keyword);
  const result = await env.DB.prepare(`
    SELECT id, nickname, name, category, description, author, url, language,
      CASE
        WHEN category = ? THEN 0.95
        WHEN author = ? THEN 0.90
        WHEN ${contains("nickname")} THEN 0.85
        WHEN ${contains("name")} THEN 0.80
        WHEN ${contains("category")} THEN 0.75
        WHEN ${contains("author")} THEN 0.70
        ELSE 0.50
      END AS match_score,
      CASE
        WHEN category = ? THEN 'category'
        WHEN author = ? THEN 'author'
        WHEN ${contains("nickname")} THEN 'nickname'
        WHEN ${contains("name")} THEN 'name'
        WHEN ${contains("category")} THEN 'category'
        WHEN ${contains("author")} THEN 'author'
        ELSE 'description'
      END AS matched_field
    FROM akyos
    WHERE language = ? AND (
      ${contains("nickname")} OR ${contains("name")} OR
      ${contains("category")} OR ${contains("description")} OR
      ${contains("author")}
    )
    ORDER BY match_score DESC, id ASC
    LIMIT ?
  `)
    .bind(
      keyword,
      keyword,
      parameter,
      parameter,
      parameter,
      parameter,
      keyword,
      keyword,
      parameter,
      parameter,
      parameter,
      parameter,
      language,
      parameter,
      parameter,
      parameter,
      parameter,
      parameter,
      limit
    )
    .all<SearchRow>();

  return (result.results ?? []).map((row) => toSearchResult(row, keyword));
}

async function findPartialNameMatches(
  keyword: string,
  language: Language,
  limit: number,
  env: Env
): Promise<SearchResult[]> {
  const { sql: contains, parameter } = createSubstringMatch(keyword);
  const result = await env.DB.prepare(`
    SELECT id, nickname, name, category, description, author, url, language,
      CASE
        WHEN ${contains("nickname")} THEN 0.85
        ELSE 0.80
      END AS match_score,
      CASE
        WHEN ${contains("nickname")} THEN 'nickname'
        ELSE 'name'
      END AS matched_field
    FROM akyos
    WHERE language = ? AND (
      ${contains("nickname")} OR ${contains("name")}
    )
    ORDER BY match_score DESC, id ASC
    LIMIT ?
  `)
    .bind(parameter, parameter, language, parameter, parameter, limit)
    .all<SearchRow>();

  return (result.results ?? []).map((row) => toSearchResult(row, keyword));
}

function metadataToResult(
  matchId: string,
  score: number,
  metadata: VectorizeMetadata,
  keyword: string,
  language: Language
): SearchResult | null {
  const id = metadata.id || matchId;
  const nickname = metadata.nickname;
  if (!id || !nickname) {
    return null;
  }

  return {
    id,
    entryType: normalizeEntryType(metadata.entryType, metadata.url),
    nickname,
    name: metadata.name ?? "",
    category: metadata.category ?? "",
    description: metadata.description ?? "",
    author: metadata.author ?? "",
    url: metadata.url ?? "",
    language: metadata.language ?? language,
    score: score * 0.6,
    matchType: "semantic",
    matchedField: "semantic",
    matchedKeyword: keyword,
  };
}

async function findVectorMatches(
  keyword: string,
  language: Language,
  limit: number,
  env: Env
): Promise<SearchResult[]> {
  const index = selectVectorIndex(env);
  const embeddings = await embedBudgeted(keyword, env);
  const vector = embeddings.data[0];
  if (!vector) {
    return [];
  }

  const candidateLimit = Math.min(limit * 3, 24);
  const vectorResults = await index.query(vector, {
    topK: candidateLimit,
    returnMetadata: true,
  });

  // Vectorize mutations become visible asynchronously. Keep live candidates
  // while re-embedding, but always return current D1 fields, never deleted rows.
  const ids = [...new Set(vectorResults.matches.map(match => match.metadata?.id || match.id))];
  if (!ids.length) return [];
  const current = await env.DB.prepare(`
    SELECT id, nickname, name, category, description, author, url, language
    FROM akyos WHERE id IN (${ids.map(() => '?').join(', ')})
  `).bind(...ids).all<AkyoRecord>();
  const rowsById = new Map((current.results ?? []).map(row => [row.id, row]));

  const results: SearchResult[] = [];
  for (const match of vectorResults.matches) {
    if (match.score < MIN_SEMANTIC_SCORE) {
      continue;
    }
    const row = rowsById.get(match.metadata?.id || match.id);
    if (!row || row.language !== language) {
      continue;
    }
    const result = metadataToResult(
      match.id,
      match.score,
      row,
      keyword,
      language
    );
    if (result) {
      results.push(result);
    }
  }
  return results;
}

function mergeResult(target: Map<string, SearchResult>, result: SearchResult): void {
  const existing = target.get(result.id);
  if (!existing || result.score > existing.score) {
    target.set(result.id, result);
  }
}

function sortAndLimit(results: Iterable<SearchResult>, limit: number): SearchResult[] {
  return [...results]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function searchSpecificNameMatches(
  rawTerms: string[],
  language: Language,
  env: Env
): Promise<SearchResult[]> {
  const limit = 1;
  const terms = normalizeSearchTerms(undefined, rawTerms);
  const exactResults = new Map<string, SearchResult>();

  const exactMatches = await Promise.all(
    terms.flatMap((term) =>
      exactCandidates(term).map((candidate) =>
        findExactMatches(candidate, language, limit, env)
      )
    )
  );
  for (const matches of exactMatches) {
    for (const match of matches) {
      mergeResult(exactResults, match);
    }
  }

  if (exactResults.size > 0) {
    return sortAndLimit(exactResults.values(), limit);
  }

  const partialResults = new Map<string, SearchResult>();
  const partialMatches = await Promise.all(
    terms.map((term) => findPartialNameMatches(term, language, limit, env))
  );
  for (const matches of partialMatches) {
    for (const match of matches) {
      mergeResult(partialResults, match);
    }
  }

  return sortAndLimit(partialResults.values(), limit);
}

export async function searchWithD1AndVectorize(
  rawTerms: string[],
  language: Language,
  requestedTopK: unknown,
  env: Env
): Promise<{ results: SearchResult[]; budgetLimited: boolean }> {
  const limit = normalizeTopK(requestedTopK);
  const terms = normalizeSearchTerms(undefined, rawTerms);
  const exactResults = new Map<string, SearchResult>();

  const exactMatches = await Promise.all(
    terms.flatMap((term) =>
      exactCandidates(term).map((candidate) =>
        findExactMatches(candidate, language, limit, env)
      )
    )
  );
  for (const matches of exactMatches) {
    for (const match of matches) {
      mergeResult(exactResults, match);
    }
  }

  if (exactResults.size > 0) {
    return { results: sortAndLimit(exactResults.values(), limit), budgetLimited: false };
  }

  const fallbackResults = new Map<string, SearchResult>();
  let budgetStopped = false;
  await Promise.all(
    terms.map(async (term) => {
      const partialPromise = findPartialMatches(term, language, limit, env);
      const vectorPromise = findVectorMatches(term, language, limit, env).catch(
        (error: unknown) => {
          if (error instanceof BudgetStoppedError) { budgetStopped = true; return []; }
          console.error("Vector search failed; returning D1 matches only", error);
          return [];
        }
      );

      const [partialMatches, vectorMatches] = await Promise.all([
        partialPromise,
        vectorPromise,
      ]);
      for (const result of [...partialMatches, ...vectorMatches]) {
        mergeResult(fallbackResults, result);
      }
    })
  );

  if (budgetStopped && fallbackResults.size === 0) throw new BudgetStoppedError();
  return { results: sortAndLimit(fallbackResults.values(), limit), budgetLimited: budgetStopped };
}
