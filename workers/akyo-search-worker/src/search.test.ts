import assert from "node:assert/strict";
import test from "node:test";

import worker from "./index";
import {
  MAX_KEYWORDS,
  exactCandidates,
  normalizeSearchTerms,
  normalizeTopK,
  searchWithD1AndVectorize,
} from "./search";
import type {
  AiBinding,
  AkyoRecord,
  D1Database,
  D1PreparedStatement,
  D1Result,
  Env,
  VectorizeIndex,
  VectorizeMatch,
  VectorizeVector,
} from "./types";

interface FakeSearchRow extends AkyoRecord {
  match_score: number;
  matched_field: string;
}

class FakeStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeDatabase,
    private readonly query: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.database.rowsFor(this.query, this.values);
    return { results: rows as T[] };
  }

  async first<T>(): Promise<T | null> {
    return null;
  }

  async run(): Promise<unknown> {
    this.database.runCalls += 1;
    return {};
  }
}

class FakeDatabase implements D1Database {
  exactRows: FakeSearchRow[] = [];
  partialRows: FakeSearchRow[] = [];
  exactCandidates: string[] = [];
  runCalls = 0;

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query);
  }

  rowsFor(query: string, values: unknown[]): FakeSearchRow[] {
    if (query.includes("WHEN id = ?")) {
      this.exactCandidates.push(String(values[0] ?? ""));
      const candidate = String(values[0] ?? "");
      return this.exactRows.filter(
        (row) =>
          row.id.toLowerCase() === candidate.toLowerCase() ||
          row.nickname.toLowerCase() === candidate.toLowerCase() ||
          row.name.toLowerCase() === candidate.toLowerCase()
      );
    }
    if (query.includes("WHEN category = ?")) {
      return this.partialRows;
    }
    return [];
  }
}

class FakeAi implements AiBinding {
  calls: string[] = [];
  failure?: Error;

  async run(_model: string, input: { text: string }): Promise<{ data: number[][] }> {
    this.calls.push(input.text);
    if (this.failure) {
      throw this.failure;
    }
    return { data: [[0.1, 0.2, 0.3]] };
  }
}

class FakeVectorize implements VectorizeIndex {
  queryTopK: number[] = [];
  upsertCalls: VectorizeVector[][] = [];

  constructor(public matches: VectorizeMatch[] = []) {}

  async query(
    _vector: number[],
    options: { topK: number; returnMetadata: true }
  ): Promise<{ matches: VectorizeMatch[] }> {
    this.queryTopK.push(options.topK);
    return { matches: this.matches };
  }

  async upsert(vectors: VectorizeVector[]): Promise<unknown> {
    this.upsertCalls.push(vectors);
    return {};
  }
}

function row(overrides: Partial<FakeSearchRow> = {}): FakeSearchRow {
  return {
    id: "0893",
    nickname: "たなばたAkyo",
    name: "七夕Akyo",
    category: "季節・行事,季節・行事/七夕",
    description: "Akyoに願いを！",
    author: "roma38（ろま38）",
    url: "https://vrchat.com/home/avatar/avtr-example",
    language: "ja",
    match_score: 0.99,
    matched_field: "nickname",
    ...overrides,
  };
}

function vectorMatches(count: number): VectorizeMatch[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1).padStart(4, "0"),
    score: 0.9 - index * 0.01,
    metadata: {
      id: String(index + 1).padStart(4, "0"),
      nickname: `候補${index + 1}Akyo`,
      name: "",
      category: "",
      description: "",
      author: "",
      url: "",
      language: "ja",
    },
  }));
}

function fakeEnv(options?: {
  database?: FakeDatabase;
  ai?: FakeAi;
  vectorize?: FakeVectorize;
  vectorizeJa?: FakeVectorize;
  ingestToken?: string;
}): Env {
  return {
    DB: options?.database ?? new FakeDatabase(),
    AI: options?.ai ?? new FakeAi(),
    VECTORIZE: options?.vectorize ?? new FakeVectorize(),
    VECTORIZE_JA: options?.vectorizeJa,
    INGEST_TOKEN: options?.ingestToken,
  };
}

test("normalizes topK to the supported 1-8 range", () => {
  assert.equal(normalizeTopK(undefined), 5);
  assert.equal(normalizeTopK(0), 1);
  assert.equal(normalizeTopK(4.9), 4);
  assert.equal(normalizeTopK(16), 8);
  assert.equal(normalizeTopK("not-a-number"), 5);
});

test("limits and deduplicates generated keyword input", () => {
  const terms = normalizeSearchTerms(undefined, [
    "たなばた",
    "Akyo",
    "たなばた",
    "キャラクター",
    "アニメ",
  ]);
  assert.deepEqual(terms, ["たなばた", "Akyo", "キャラクター"]);
  assert.equal(terms.length, MAX_KEYWORDS);
  assert.deepEqual(normalizeSearchTerms("たなばたAkyo", []), ["たなばたAkyo"]);
});

test("extracts exact avatar candidates from natural-language questions", () => {
  assert.deepEqual(exactCandidates("たなばたAkyoについて教えて"), [
    "たなばたAkyo",
    "たなばたAkyoについて教えて",
  ]);
  assert.deepEqual(exactCandidates("#Avatar0504"), ["0504", "#Avatar0504"]);
});

test("returns an exact D1 match without invoking Workers AI", async () => {
  const database = new FakeDatabase();
  database.exactRows = [row()];
  const ai = new FakeAi();
  const vectorizeJa = new FakeVectorize(vectorMatches(20));

  const results = await searchWithD1AndVectorize(
    ["たなばたAkyoについて教えて"],
    "ja",
    5,
    fakeEnv({ database, ai, vectorizeJa })
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].nickname, "たなばたAkyo");
  assert.equal(results[0].matchType, "exact");
  assert.deepEqual(ai.calls, []);
  assert.deepEqual(vectorizeJa.queryTopK, []);
  assert.ok(database.exactCandidates.includes("たなばたAkyo"));
});

test("globally limits merged results and uses the populated shared index", async () => {
  const database = new FakeDatabase();
  database.partialRows = [
    row({ id: "9999", nickname: "部分一致Akyo", match_score: 0.85 }),
  ];
  const ai = new FakeAi();
  const fallbackIndex = new FakeVectorize(vectorMatches(20));
  const japaneseIndex = new FakeVectorize(vectorMatches(20));

  const results = await searchWithD1AndVectorize(
    ["七夕っぽいアバター"],
    "ja",
    5,
    fakeEnv({
      database,
      ai,
      vectorize: fallbackIndex,
      vectorizeJa: japaneseIndex,
    })
  );

  assert.equal(results.length, 5);
  assert.deepEqual(fallbackIndex.queryTopK, [15]);
  assert.deepEqual(japaneseIndex.queryTopK, []);
  assert.equal(ai.calls.length, 1);
});

test("falls back to D1 results when semantic search fails", async () => {
  const database = new FakeDatabase();
  database.partialRows = [row({ match_score: 0.85 })];
  const ai = new FakeAi();
  ai.failure = new Error("Workers AI unavailable");

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const results = await searchWithD1AndVectorize(
      ["たなばた"],
      "ja",
      5,
      fakeEnv({ database, ai })
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].nickname, "たなばたAkyo");
  } finally {
    console.error = originalConsoleError;
  }
});

test("search endpoint clamps topK before returning results", async () => {
  const database = new FakeDatabase();
  const sharedIndex = new FakeVectorize(vectorMatches(20));
  const japaneseIndex = new FakeVectorize();
  const response = await worker.fetch(
    new Request("https://worker.example/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "七夕っぽいアバター", topK: 100 }),
    }),
    fakeEnv({ database, vectorize: sharedIndex, vectorizeJa: japaneseIndex })
  );
  const body = (await response.json()) as { count: number; results: unknown[] };

  assert.equal(response.status, 200);
  assert.equal(body.count, 8);
  assert.equal(body.results.length, 8);
  assert.deepEqual(sharedIndex.queryTopK, [24]);
  assert.deepEqual(japaneseIndex.queryTopK, []);
});

test("insert endpoint requires a configured bearer token", async () => {
  const request = new Request("https://worker.example/insert-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records: [] }),
  });
  const missingSecret = await worker.fetch(request, fakeEnv());
  assert.equal(missingSecret.status, 503);

  const unauthorized = await worker.fetch(
    new Request("https://worker.example/insert-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ records: [] }),
    }),
    fakeEnv({ ingestToken: "expected-token" })
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await worker.fetch(
    new Request("https://worker.example/insert-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer expected-token",
      },
      body: JSON.stringify({ records: [] }),
    }),
    fakeEnv({ ingestToken: "expected-token" })
  );
  assert.equal(authorized.status, 200);
});
