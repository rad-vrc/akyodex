import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

import worker from "./index";
import { allowsDiscoveryOnNameMiss, exactCandidates, isSpecificNameQuery } from "./search";
import type { D1Database, Env, SearchResult } from "./types";

const requireFromHere = createRequire(import.meta.url);
const requireFromWrangler = createRequire(requireFromHere.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireFromWrangler("miniflare");

interface LocalRuntime {
  getD1Database(binding: string): Promise<D1Database>;
  dispose(): Promise<void>;
}

const worldQuestions = [
  "#0746のワールドについて教えて",
  "0746番のワールドについて説明してください",
  "746番のワールドを教えて",
  "#0746のワールドを知りたいです",
  "#0746のワールドを説明して",
  "Tell me about #World0746",
];

describe("numbered requests against real local D1", () => {
  let runtime: LocalRuntime;
  let db: D1Database;

  before(async () => {
    runtime = new Miniflare({
      ...convertV4MiniflareOptions({
        script: "export default { fetch() { return new Response('local D1 only'); } };",
        modules: true,
        compatibilityDate: "2025-11-09",
        cf: false,
        d1Databases: { DB: "numbered-search-regression" },
        outboundService: () => new Response("Network disabled", { status: 403 }),
      }),
      telemetry: { enabled: false },
    });
    db = await runtime.getD1Database("DB");
    await db.prepare(`CREATE TABLE akyos (
      id TEXT PRIMARY KEY, nickname TEXT NOT NULL, name TEXT, category TEXT,
      description TEXT, author TEXT, url TEXT, language TEXT DEFAULT 'ja'
    )`).run();
    for (const [id, nickname, name, type] of [
      ["0746", "Target World", "", "world"],
      ["0017", "Target Akyo", "Akyo", "avatar"],
      ["0001", "#9999のワールド", "#9999", "world"],
      ["0002", "#8888のワールド extra", "#8888 extra", "world"],
      ["0003", "#0746のワールド", "0746", "world"],
      ["0004", "Semantic alternative", "", "world"],
    ]) {
      await db.prepare(`INSERT INTO akyos
        (id, nickname, name, category, description, author, url, language)
        VALUES (?, ?, ?, '', '', '', ?, 'ja')`)
        .bind(id, nickname, name, `https://vrchat.com/home/${type}/test-${id}`).run();
    }
  });

  after(async () => { await runtime?.dispose(); });

  async function search(input: object) {
    const aiInputs: Array<string | string[]> = [];
    const vectorQueries: number[] = [];
    const env: Env = {
      DB: db,
      AI: { async run(_model, request) {
        aiInputs.push(request.text);
        return { data: [[0.1, 0.2]] };
      } },
      VECTORIZE: {
        async query(_vector, options) {
          vectorQueries.push(options.topK);
          return { matches: [{ id: "0004", score: 0.99 }] };
        },
        async upsert() { throw new Error("Unexpected vector write"); },
      },
    };
    const response = await worker.fetch(new Request("https://worker.example/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      searchMode: string; nameMatch?: boolean; count: number; results: SearchResult[];
    };
    return { body, aiInputs, vectorQueries };
  }

  for (const query of worldQuestions) {
    it(`uses only the requested world ID: ${query}`, async () => {
      assert.equal(isSpecificNameQuery(query), true);
      assert.equal(exactCandidates(query)[0], "0746");
      assert.equal(allowsDiscoveryOnNameMiss(query), false);
      const { body, aiInputs, vectorQueries } = await search({
        query, keywords: ["Semantic alternative"], topK: 8,
      });
      assert.equal(body.searchMode, "specific-name");
      assert.equal(body.nameMatch, true);
      assert.equal(body.count, 1);
      assert.deepEqual(body.results.map(row => [row.id, row.entryType, row.matchedField]),
        [["0746", "world", "id"]]);
      assert.deepEqual(aiInputs, []);
      assert.deepEqual(vectorQueries, []);
    });
  }

  for (const query of ["#9999のワールドを教えて", "#8888のワールドについて教えて", "#9999", "#8888"]) {
    it(`does not substitute an exact name, partial name or semantic result for missing ID: ${query}`, async () => {
      const { body, aiInputs, vectorQueries } = await search({ query, language: "ja" });
      assert.equal(body.searchMode, "specific-name");
      assert.equal(body.nameMatch, false);
      assert.equal(body.count, 0);
      assert.deepEqual(body.results, []);
      assert.deepEqual(aiInputs, []);
      assert.deepEqual(vectorQueries, []);
    });
  }

  it("supports a keyword-only numbered world request", async () => {
    const { body, aiInputs } = await search({ keywords: ["#0746のワールド"] });
    assert.equal(body.searchMode, "specific-name");
    assert.deepEqual(body.results.map(row => row.id), ["0746"]);
    assert.deepEqual(aiInputs, []);
  });

  it("preserves existing numeric and Akyo requests and adds the avatar noun", async () => {
    for (const query of ["#0746について教えて", "#Avatar0017", "17番のAkyoについて教えて", "#0017のアバターを教えて"]) {
      const { body, aiInputs } = await search({ query });
      assert.equal(body.searchMode, "specific-name", query);
      assert.deepEqual(body.results.map(row => row.id), [query.includes("0746") ? "0746" : "0017"], query);
      assert.deepEqual(aiInputs, []);
    }
  });

  it("does not turn quantities or descriptive requests into numbered lookups", async () => {
    for (const query of ["3つのワールドを教えて", "ワールドを3件教えて", "#0746のワールドに似た場所", "#0746と#0017を比べて"]) {
      assert.equal(isSpecificNameQuery(query), false, query);
    }
    const { body, aiInputs } = await search({ query: "静かなワールドを教えて", language: "ja" });
    assert.equal(body.searchMode, "discovery");
    assert.deepEqual(body.results.map(row => row.id), ["0004"]);
    assert.equal(aiInputs.length, 1);
  });
});
