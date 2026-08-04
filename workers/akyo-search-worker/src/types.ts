export type Language = "ja" | "en" | "ko";

export interface AkyoRecord {
  id: string;
  nickname: string;
  name: string;
  category: string;
  description: string;
  author: string;
  url: string;
  language: Language;
}

export interface SearchResult extends AkyoRecord {
  score: number;
  matchType: "exact" | "partial" | "semantic";
  matchedField: string;
  matchedKeyword: string;
}

export interface D1Result<T> {
  results?: T[];
  success?: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface AiBinding {
  run(
    model: string,
    input: { text: string | string[] }
  ): Promise<{ data: number[][] }>;
}

export interface VectorizeMetadata extends Partial<AkyoRecord> {
  appearance?: string;
}

export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: VectorizeMetadata;
}

export interface VectorizeVector {
  id: string;
  values: number[];
  metadata: VectorizeMetadata;
}

export interface VectorizeIndex {
  query(
    vector: number[],
    options: { topK: number; returnMetadata: true }
  ): Promise<{ matches: VectorizeMatch[] }>;
  upsert(vectors: VectorizeVector[]): Promise<unknown>;
}

export interface Env {
  AI: AiBinding;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  VECTORIZE_EN?: VectorizeIndex;
  VECTORIZE_JA?: VectorizeIndex;
  INGEST_TOKEN?: string;
}

export interface CountResult {
  count: number;
  examples?: Array<Pick<AkyoRecord, "id" | "nickname" | "category" | "author">>;
  avatars?: Array<Pick<AkyoRecord, "id" | "nickname" | "category" | "language">>;
}
