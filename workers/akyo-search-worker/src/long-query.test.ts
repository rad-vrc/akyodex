import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

import worker from "./index";
import type { AkyoRecord, D1Database, Env, Language, SearchResult } from "./types";

// Resolve the local D1 runtime from the dependency that owns it, not a global CLI.
const requireFromHere = createRequire(import.meta.url);
const requireFromWrangler = createRequire(requireFromHere.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireFromWrangler("miniflare");

interface LocalRuntime {
  getD1Database(binding: string): Promise<D1Database>;
  dispose(): Promise<void>;
}

interface ResponseBody {
  query?: string;
  keywords?: string[];
  searchMode?: string;
  nameMatch?: boolean;
  results: SearchResult[];
  count: number;
  error?: string;
  examples?: Array<{ id: string }>;
  avatars?: Array<{ id: string }>;
}

describe("long input against real local D1", () => {
  let runtime: LocalRuntime;
  let db: D1Database;

  before(async () => {
    runtime = new Miniflare({
      ...convertV4MiniflareOptions({
        script: "export default { fetch() { return new Response('local D1 only'); } };",
        modules: true,
        compatibilityDate: "2025-11-09",
        cf: false,
        d1Databases: { DB: "long-query-regression" },
        outboundService: () => new Response("Network disabled", { status: 403 }),
      }),
      telemetry: { enabled: false },
    });
    db = await runtime.getD1Database("DB");
    await db.prepare(`CREATE TABLE akyos (
      id TEXT PRIMARY KEY, nickname TEXT NOT NULL, name TEXT, category TEXT,
      description TEXT, author TEXT, url TEXT, language TEXT DEFAULT 'ja'
    )`).run();
  });

  after(async () => { await runtime?.dispose(); });
  beforeEach(async () => { await db.prepare("DELETE FROM akyos").run(); });

  async function seed(id: string, fields: Partial<AkyoRecord> = {}) {
    const row = {
      nickname: `record ${id}`, name: "", category: "", description: "",
      author: "", url: "https://example.invalid/avatar", language: "en", ...fields,
    };
    await db.prepare(`INSERT INTO akyos
      (id, nickname, name, category, description, author, url, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, row.nickname, row.name, row.category, row.description,
      row.author, row.url, row.language).run();
  }

  function environment(options: { aiFailure?: boolean; semanticIds?: string[] } = {}) {
    const aiInputs: Array<string | string[]> = [];
    const env: Env = {
      DB: db,
      AI: {
        async run(_model, input) {
          aiInputs.push(input.text);
          if (options.aiFailure) throw new Error("Local AI failure");
          return { data: [[0.1, 0.2]] };
        },
      },
      VECTORIZE: {
        async query() {
          return { matches: (options.semanticIds ?? []).map(id => ({ id, score: 0.9 })) };
        },
        async upsert() { throw new Error("Unexpected vector write"); },
      },
    };
    return { env, aiInputs };
  }

  async function post(path: string, input: object, env = environment().env) {
    const response = await worker.fetch(new Request(`https://worker.example${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }), env);
    const body = await response.json() as ResponseBody;
    assert.equal(response.status, 200, body.error);
    return body;
  }

  it("enforces D1's 50-byte LIKE boundary, unlike stock SQLite", async () => {
    assert.deepEqual(await db.prepare("SELECT ? LIKE ? AS matched")
      .bind("seed", "x".repeat(50)).first(), { matched: 0 });
    await assert.rejects(db.prepare("SELECT ? LIKE ? AS matched")
      .bind("seed", "x".repeat(51)).first(), /LIKE or GLOB pattern too complex/u);
  });

  const boundaries: Array<[string, string, Language]> = [
    ["ASCII at 50 bytes", "x".repeat(48), "en"],
    ["ASCII at 51 bytes", "x".repeat(49), "en"],
    ["Japanese at 50 bytes", "\u3042".repeat(16), "ja"],
    ["Japanese plus ASCII at 51 bytes", "\u3042".repeat(16) + "x", "ja"],
    ["Japanese at 53 bytes", "\u3042".repeat(17), "ja"],
    ["Korean at 50 bytes", "\uac00".repeat(16), "ko"],
    ["Korean at 53 bytes", "\uac00".repeat(17), "ko"],
    ["emoji at 50 bytes", "\u{1f600}".repeat(12), "en"],
    ["emoji above 50 bytes", "\u{1f600}".repeat(13), "en"],
    ...["%", "_", "\\"].flatMap((symbol): Array<[string, string, Language]> => [
      [`escaped ${symbol} at 50 bytes`, symbol.repeat(24), "en"],
      [`escaped ${symbol} above 50 bytes`, symbol.repeat(25), "en"],
    ]),
  ];

  for (const [label, keyword, language] of boundaries) {
    it(`searches the complete literal input: ${label}`, async () => {
      await seed("0001", { nickname: `[${keyword}]`, language });
      await seed("0002", { nickname: `[${keyword.slice(0, -1)}z]`, language });
      const { env, aiInputs } = environment();
      const body = await post("/search", { query: keyword, language }, env);
      assert.deepEqual(body.results.map(row => row.id), ["0001"]);
      assert.equal(body.query, keyword);
      assert.equal(body.results[0].matchedKeyword, keyword);
      assert.equal(body.results[0].matchedField, "nickname");
      assert.equal(body.results[0].score, 0.85);
      assert.deepEqual(aiInputs, [keyword]);
    });
  }

  it("keeps long-query field scores, ordering, limits, and language filtering", async () => {
    const keyword = "LongLiteral".repeat(5);
    await seed("0001", { category: keyword });
    await seed("0002", { author: keyword });
    await seed("0003", { nickname: `[${keyword.toUpperCase()}]` });
    await seed("0004", { name: `[${keyword}]` });
    await seed("0005", { category: `[${keyword}]` });
    await seed("0006", { author: `[${keyword}]` });
    await seed("0007", { description: `[${keyword}]` });
    await seed("0008", { nickname: `[${keyword}]`, language: "ja" });
    await seed("0009", { nickname: `[${keyword.slice(0, -1)}z]` });
    const body = await post("/search", { query: keyword, language: "en", topK: 8 });
    assert.deepEqual(body.results.map(row => [row.id, row.score, row.matchedField]), [
      ["0001", 0.95, "category"], ["0002", 0.90, "author"],
      ["0003", 0.85, "nickname"], ["0004", 0.80, "name"],
      ["0005", 0.75, "category"], ["0006", 0.70, "author"],
      ["0007", 0.50, "description"],
    ]);
    const limited = await post("/search", { query: keyword, language: "en", topK: 2 });
    assert.deepEqual(limited.results.map(row => row.id), ["0001", "0002"]);
  });

  for (const field of ["nickname", "name"] as const) {
    it(`uses long specific-name ${field} matches without semantic substitution`, async () => {
      const keyword = "x".repeat(45) + "Akyo";
      await seed("0001", { [field]: `[${keyword}]` });
      const { env, aiInputs } = environment({ semanticIds: ["0001"] });
      const body = await post("/search", {
        query: keyword, keywords: ["different"], language: "en",
      }, env);
      assert.equal(body.searchMode, "specific-name");
      assert.equal(body.nameMatch, true);
      assert.equal(body.count, 1);
      assert.equal(body.results[0].matchedField, field);
      assert.equal(body.results[0].score, field === "nickname" ? 0.85 : 0.80);
      const missing = await post("/search", { keywords: ["y".repeat(45) + "Akyo"] }, env);
      assert.equal(missing.nameMatch, false);
      assert.deepEqual(missing.results, []);
      assert.deepEqual(aiInputs, []);
    });
  }

  it("preserves long exact names and natural-language cleanup without invoking AI", async () => {
    const keyword = "x".repeat(60) + "Akyo";
    await seed("0001", { nickname: keyword, language: "ja" });
    const { env, aiInputs } = environment();
    const query = `Tell me about ${keyword}`;
    const body = await post("/search", { query, language: "en" }, env);
    assert.equal(body.query, query);
    assert.equal(body.results[0].matchType, "exact");
    assert.equal(body.results[0].language, "ja");
    assert.deepEqual(aiInputs, []);
  });

  it("preserves keyword precedence and mixed-length discovery terms", async () => {
    const long = "x".repeat(49);
    await seed("0001", { nickname: `[${long}]` });
    await seed("0002", { nickname: "[short]" });
    const { env, aiInputs } = environment();
    const body = await post("/search", { query: "ignored", keywords: [long, "short"] }, env);
    assert.deepEqual(body.keywords, [long, "short"]);
    assert.deepEqual(body.results.map(row => row.id), ["0001", "0002"]);
    assert.deepEqual(aiInputs, [long, "short"]);
    const short = await post("/search", { query: long, keywords: ["short"] }, env);
    assert.deepEqual(short.results.map(row => row.id), ["0002"]);
  });

  it("returns semantic candidates for a long natural question without truncating AI input", async () => {
    const query = "I am looking for a small avatar with colorful clothing and a red hat";
    await seed("0001");
    const { env, aiInputs } = environment({ semanticIds: ["0001"] });
    const body = await post("/search", { query }, env);
    assert.equal(body.searchMode, "discovery");
    assert.equal(body.results[0].matchType, "semantic");
    assert.equal(body.results[0].matchedKeyword, query);
    assert.deepEqual(aiInputs, [query]);
  });

  it("keeps long lexical results when AI fails", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const query = "x".repeat(49);
    await seed("0001", { description: `[${query}]` });
    const body = await post("/search", { query }, environment({ aiFailure: true }).env);
    assert.deepEqual(body.results.map(row => row.id), ["0001"]);
  });

  for (const keyword of ["x".repeat(48), "x".repeat(49), "%_\\".repeat(9), "\u3042".repeat(17)]) {
    it(`counts all matching fields without truncation (${Buffer.byteLength(keyword)} raw bytes)`, async () => {
      for (const [index, field] of ["category", "author", "nickname", "name"].entries()) {
        await seed(`000${index + 1}`, { [field]: `[${keyword}]` });
      }
      await seed("0005", { description: `[${keyword}]` });
      await seed("0006", { category: `[${keyword}]`, language: "ja" });
      await seed("0007", { category: `[${keyword.slice(0, -1)}z]` });
      const body = await post("/count", { keyword, language: "en" });
      assert.equal(body.count, 4);
      assert.deepEqual(body.examples?.map(row => row.id), ["0001", "0002", "0003", "0004"]);
    });
  }

  it("preserves exact-author counts and the ten-example count limit", async () => {
    const author = "x".repeat(49);
    for (let index = 1; index <= 12; index++) {
      await seed(String(index).padStart(4, "0"), { author });
    }
    const exact = await post("/count", { author });
    assert.equal(exact.count, 12);
    assert.equal(exact.avatars?.length, 10);
    const partial = await post("/count", { keyword: author, language: "en" });
    assert.equal(partial.count, 12);
    assert.equal(partial.examples?.length, 10);
  });

  for (const suffix of ["", "x".repeat(49)]) {
    it(`preserves ASCII-only case folding (${suffix ? "long" : "short"} input)`, async () => {
      const keyword = `\u00c4AbC${suffix}`;
      await seed("0001", { category: `[\u00c4aBc${suffix.toUpperCase()}]` });
      await seed("0002", { category: `[\u00e4aBc${suffix}]` });
      const body = await post("/count", { keyword, language: "en" });
      assert.deepEqual(body.examples?.map(row => row.id), ["0001"]);
    });
  }

  it("preserves NUL and nullable-field behavior on both sides of the boundary", async () => {
    await seed("0001", { category: "prefix\0tail" });
    await db.prepare("UPDATE akyos SET name = NULL, author = NULL WHERE id = '0001'").run();
    const body = await post("/count", { keyword: "tail", language: "en" });
    assert.equal(body.count, 0);
    const prefix = "x".repeat(45);
    await db.prepare("UPDATE akyos SET category = ? WHERE id = '0001'").bind(prefix).run();
    const nul = await post("/count", { keyword: `${prefix}\0ab`, language: "en" });
    assert.equal(nul.count, 1);
    const long = "x".repeat(49) + "\0tail";
    await db.prepare("UPDATE akyos SET category = ? WHERE id = '0001'").bind(`[${long}]`).run();
    await seed("0002", { category: `[${"x".repeat(49)}\0different]` });
    const literal = await post("/count", { keyword: long, language: "en" });
    assert.deepEqual(literal.examples?.map(row => row.id), ["0001"]);
  });

  it("does not hide unrelated D1 failures behind empty search results", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const { env } = environment();
    env.DB = {
      prepare() { throw new Error("Unrelated D1 failure"); },
      batch: db.batch.bind(db),
    };
    const response = await worker.fetch(new Request("https://worker.example/search", {
      method: "POST", body: JSON.stringify({ query: "x".repeat(49) }),
    }), env);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Unrelated D1 failure" });
  });
});
