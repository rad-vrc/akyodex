import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { getPublicDisplayId } from "../../../src/lib/akyo-entry";
import type { AkyoData } from "../../../src/types/akyo";
import worker from "./index";
import type { AkyoRecord, D1Database, Env, SearchResult } from "./types";

const require = createRequire(import.meta.url);
const requireFromWrangler = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireFromWrangler("miniflare");
const { buildPayload } = require("../../../scripts/generate-vectorize-payload.js");
const { reconcileCatalog } = require("../../../scripts/sync-ai-catalog.js");
interface LocalRuntime {
  getD1Database(binding: string): Promise<D1Database>;
  dispose(): Promise<void>;
}

async function harness() {
  const runtime: LocalRuntime = new Miniflare({
    ...convertV4MiniflareOptions({
      script: "export default { fetch() { return new Response('local D1 only'); } };",
      modules: true, compatibilityDate: "2025-11-09", cf: false,
      d1Databases: { DB: "public-number-regression" },
      outboundService: () => new Response("Network disabled", { status: 403 }),
    }), telemetry: { enabled: false },
  });
  const db = await runtime.getD1Database("DB");
  await db.prepare(`CREATE TABLE akyos (id TEXT PRIMARY KEY, nickname TEXT NOT NULL,
    name TEXT, category TEXT, description TEXT, author TEXT, url TEXT, language TEXT)`).run();
  let aiCalls = 0;
  let vectorCalls = 0;
  const env: Env = {
    DB: db,
    AI: { async run() { aiCalls++; return { data: [[0.1, 0.2]] }; } },
    VECTORIZE: {
      async query() { vectorCalls++; return { matches: [] }; },
      async upsert() { throw new Error("Unexpected vector write"); },
    },
  };
  const request = async (input: object) => {
    const response = await worker.fetch(new Request("https://worker.example/search", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }), env);
    const body = await response.json() as { searchMode: string; nameMatch?: boolean; count: number;
      directAnswer?: string; error?: string; results: SearchResult[] };
    return { response, body };
  };
  return { runtime, db, env, request, counts: () => ({ aiCalls, vectorCalls }) };
}

describe("public numbers against real local D1", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  before(async () => {
    h = await harness();
    await h.db.prepare("ALTER TABLE akyos ADD COLUMN publicId TEXT NOT NULL DEFAULT ''").run();
    for (const [id, publicId, nickname, type] of [
      ["0001", "Avatar0001", "OriginAkyo", "avatar"],
      ["0746", "World0001", "Japan Street", "world"],
      ["2030", "Avatar0896", "MenmeAkyo", "avatar"],
      ["2034", "Avatar0900", "NewestAkyo", "avatar"],
      ["0896", "Avatar0812", "Wrong internal-ID candidate", "avatar"],
      ["0002", "Avatar0002", "#World9999", "avatar"],
      ["0003", "Avatar0003", "#8888 extra", "avatar"],
    ]) await h.db.prepare("INSERT INTO akyos VALUES (?, ?, '', '', '', '', ?, 'ja', ?)")
      .bind(id, nickname, `https://vrchat.com/home/${type}/test-${id}`, publicId).run();
  });
  after(async () => { await h?.runtime.dispose(); });

  for (const [query, id, publicId] of [
    ["#World0001について教えて", "0746", "World0001"],
    ["1番のワールドを教えて", "0746", "World0001"],
    ["#0001のワールドについて教えて", "0746", "World0001"],
    ["#Avatar0896について教えて", "2030", "Avatar0896"],
    ["896番のアバターを教えて", "2030", "Avatar0896"],
    ["#0896のAkyoを知りたいです", "2030", "Avatar0896"],
    ["Tell me about #World0001", "0746", "World0001"],
    ["＃Ａｖａｔａｒ０８９６について教えて", "2030", "Avatar0896"],
    ["#0001 のワールドを説明してください", "0746", "World0001"],
    ["#World0001の作者は誰？", "0746", "World0001"],
    ["#0896", "2030", "Avatar0896"], ["900", "2034", "Avatar0900"],
  ]) it(`resolves the displayed number, not an internal ID: ${query}`, async () => {
    const { response, body } = await h.request({ query, keywords: ["Wrong internal-ID candidate"], topK: 8 });
    assert.equal(response.status, 200);
    assert.equal(body.searchMode, "specific-name");
    assert.equal(body.nameMatch, true);
    assert.equal(body.count, 1);
    assert.deepEqual(body.results.map(r => [r.id, r.publicId, r.matchedField]), [[id, publicId, "publicId"]]);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  });
  for (const query of ["#0001", "1番", "0001について教えて"]) it(`asks which public series is meant: ${query}`, async () => {
    const { response, body } = await h.request({ query, language: "ja" });
    assert.equal(response.status, 200);
    assert.equal(body.searchMode, "clarification");
    assert.match(body.directAnswer ?? "", /#Avatar0001/);
    assert.match(body.directAnswer ?? "", /#World0001/);
    assert.deepEqual(body.results, []);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  });
  for (const query of ["#World0746", "#0746のワールドを教えて", "#World9999", "#8888", "#2030"]) {
    it(`does not fall back to internal IDs, names or semantic candidates: ${query}`, async () => {
      const { response, body } = await h.request({ query, language: "ja" });
      assert.equal(response.status, 200);
      assert.equal(body.searchMode, "specific-name");
      assert.equal(body.nameMatch, false);
      assert.deepEqual(body.results, []);
      assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
    });
  }
  it("resolves an explicit public number in keyword-only input", async () => {
    const { body } = await h.request({ keywords: ["#World0001"] });
    assert.deepEqual(body.results.map(r => r.id), ["0746"]);
  });
  it("fails closed on duplicate public numbers or a type-inconsistent row", async () => {
    await h.db.prepare("INSERT INTO akyos VALUES ('9000', 'Duplicate', '', '', '', '', '', 'ja', 'Avatar0896')").run();
    try { assert.equal((await h.request({ query: "#Avatar0896" })).response.status, 503); }
    finally { await h.db.prepare("DELETE FROM akyos WHERE id = '9000'").run(); }
    await h.db.prepare("UPDATE akyos SET url = 'https://vrchat.com/home/avatar/avtr-wrong' WHERE id = '0746'").run();
    try { assert.equal((await h.request({ query: "#World0001" })).response.status, 503); }
    finally { await h.db.prepare("UPDATE akyos SET url = 'https://vrchat.com/home/world/wrld-correct' WHERE id = '0746'").run(); }
  });
  it("does not guess while any public numbers remain unsynchronized", async () => {
    await h.db.prepare("UPDATE akyos SET publicId = '' WHERE id = '0746'").run();
    try {
      const { response, body } = await h.request({ query: "#0001" });
      assert.equal(response.status, 503);
      assert.match(body.error ?? "", /catalog sync/);
    } finally { await h.db.prepare("UPDATE akyos SET publicId = 'World0001' WHERE id = '0746'").run(); }
  });
  it("does not treat quantities, years or comparisons as one public number", async () => {
    for (const input of [
      { query: "3つのワールドを教えて" }, { query: "2025のアバターを教えて" },
      { query: "#World0001に似た場所" }, { query: "#0001と#0896を比べて" },
      { keywords: ["World 3"] },
    ]) {
      const { response, body } = await h.request(input);
      assert.equal(response.status, 200);
      assert.notEqual(body.searchMode, "specific-name");
      assert.ok(body.results.every(r => r.matchedField !== "id"));
    }
  });
});

it("migrates the actual catalog then resolves every site's public number with no embeddings", async t => {
  const h = await harness();
  const source = JSON.parse(readFileSync(new URL("../../../data/akyo-data-ja.json", import.meta.url), "utf8"));
  const items: AkyoData[] = source.data ?? source;
  const records: AkyoRecord[] = buildPayload(source);
  let writes = 0;
  const api = {
    async query(sql: string, params: unknown[] = []) {
      if (!/^(SELECT|PRAGMA)/.test(sql)) writes++;
      return (await h.db.prepare(sql).bind(...params).all()).results ?? [];
    },
    async listIds() { return records.map(r => r.id); },
    async getVectors(ids: string[]) { return records.filter(r => ids.includes(r.id)).map(r => ({ id: r.id, metadata: r })); },
    async embed() { throw new Error("Display numbers must not regenerate embeddings"); },
    async upsert() { throw new Error("Display numbers must not update vectors"); },
    async remove() { throw new Error("Unexpected removal"); },
  };
  try {
    assert.equal((await h.request({ query: "#World0001" })).response.status, 503);
    await reconcileCatalog(records, api);
    for (const item of items) {
      const publicId = getPublicDisplayId(item);
      for (const query of [`#${publicId}について教えて`, `${Number(publicId.replace(/^(Avatar|World)/, ""))}番の${publicId.startsWith("World") ? "ワールド" : "アバター"}を教えて`]) {
        const { response, body } = await h.request({ query });
        assert.equal(response.status, 200, query);
        assert.equal(body.searchMode, "specific-name", query);
        assert.deepEqual(body.results.map(r => r.id), [item.id], query);
        assert.equal(body.results[0].publicId, publicId, query);
      }
    }
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
    const before = writes;
    const repeated = await reconcileCatalog(records, api);
    assert.equal(repeated.rowsUpdated, 0);
    assert.equal(writes, before);
    t.diagnostic(`${items.length} public IDs, ${items.length * 2} queries matched the site's getPublicDisplayId`);
  } finally { await h.runtime.dispose(); }
});
