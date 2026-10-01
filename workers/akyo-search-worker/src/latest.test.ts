import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { selectLatestEntries } from "../../../src/lib/akyo-entry";
import worker from "./index";
import { ingestRecords } from "./ingest";
import type { D1Database, D1PreparedStatement, Env } from "./types";

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE akyos (id TEXT PRIMARY KEY, nickname TEXT, name TEXT,
    category TEXT, description TEXT, author TEXT, url TEXT, language TEXT, urlUpdatedAt TEXT)`);
  const data = [
    { id: "2030", urlUpdatedAt: "2026-10-01T00:00:00Z" },
    { id: "0917", urlUpdatedAt: "2026-09-01T00:00:00Z" },
    { id: "0001", urlUpdatedAt: "2026-10-02T09:00:00+09:00" },
    { id: "0002", urlUpdatedAt: "2026-10-02T00:00:00Z" },
    { id: "9999", urlUpdatedAt: "invalid" },
    { id: "9998", urlUpdatedAt: "2027" },
  ];
  for (const row of data) db.prepare("INSERT INTO akyos VALUES (?, ?, '', '', '', '', ?, 'ja', ?)")
    .run(row.id, `Item${row.id}Akyo`, row.id === "0002" ? "https://vrchat.com/home/world/wrld-example" : "", row.urlUpdatedAt);
  let aiCalls = 0;
  let vectorCalls = 0;
  const database: D1Database = {
    prepare(sql) {
      const statement = (values: unknown[]): D1PreparedStatement => ({
        bind: (...args) => statement(args),
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
        first: async <T>() => (db.prepare(sql).all(...values)[0] as T) ?? null,
        run: async () => db.prepare(sql).run(...values),
      });
      return statement([]);
    },
    batch: <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.all<T>())),
  };
  const env: Env = { DB: database,
    AI: { async run() { aiCalls++; return { data: [[1, 2]] }; } },
    VECTORIZE: { async query() { vectorCalls++; return { matches: [] }; }, async upsert() {} },
  };
  return { db, env, data, counts: () => ({ aiCalls, vectorCalls }) };
}

async function search(env: Env, body: object) {
  const response = await worker.fetch(new Request("https://worker.test/search", {
    method: "POST", body: JSON.stringify(body),
  }), env);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ searchMode: string; count: number;
    results: { id: string; entryType: string; language: string; urlUpdatedAt?: string }[] }>;
}

test("latest requests follow the same timestamp/internal-ID order as the catalog, without AI", async () => {
  const h = fixture();
  try {
    for (const body of [
      { query: "最新のakyoは？" }, { query: "最近追加されたAkyoを教えて" },
      { query: "What is the latest Akyo?", language: "en" },
      { query: "최근 추가된 Akyo 알려주세요", language: "ko" },
      { keywords: ["最新", "Akyo"] }, { keywords: ["latest"] },
    ]) {
      const result = await search(h.env, { ...body, topK: 8 });
      assert.equal(result.searchMode, "latest");
      assert.deepEqual(result.results.map(r => r.id), selectLatestEntries(h.data, 8).map(r => r.id));
      assert.equal(result.results[0].entryType, "world");
      assert.equal(result.results[0].language, "ja", "JA fallback is not relabelled as a translation");
    }
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  } finally { h.db.close(); }
});

test("latest search observes subsequent timestamp edits/deletions and clamps topK", async () => {
  const h = fixture();
  try {
    assert.equal((await search(h.env, { query: "最新のAkyo", topK: 1 })).results[0].id, "0002");
    h.db.prepare("UPDATE akyos SET urlUpdatedAt = ? WHERE id = '2030'").run("2026-10-03T00:00:00Z");
    assert.equal((await search(h.env, { query: "最新のAkyo", topK: 1 })).results[0].id, "2030");
    h.db.exec("DELETE FROM akyos WHERE id = '2030'");
    assert.equal((await search(h.env, { query: "最新のAkyo", topK: 1 })).results[0].id, "0002");
    h.db.exec("DELETE FROM akyos");
    assert.equal((await search(h.env, { query: "最新のAkyo" })).count, 0);
  } finally { h.db.close(); }
});

test("names and qualified/negated latest questions do not silently return the global latest", async () => {
  const h = fixture();
  try {
    for (const body of [
      { query: "Item2030Akyoについて教えて" }, { query: "最新ではないAkyo" },
      { query: "最新の青いAkyo" }, { query: "latest news about Item2030Akyo" },
      { keywords: ["最新", "青"] }, { query: "Item2030Akyo", keywords: ["最新"] },
    ]) assert.notEqual((await search(h.env, body)).searchMode, "latest");
  } finally { h.db.close(); }
});

test("latest uses requested-language rows when available, with explicit JA fallback only when absent", async () => {
  const h = fixture();
  try {
    h.db.exec("UPDATE akyos SET language = 'en' WHERE id = '2030'");
    const result = await search(h.env, { query: "latest Akyo", language: "en" });
    assert.deepEqual(result.results.map(r => r.id), ["2030"]);
    assert.equal(result.results[0].language, "en");
    assert.equal((await search(h.env, { query: "latest Akyo", language: "ko" })).results[0].language, "ja");
  } finally { h.db.close(); }
});

test("latest does not fall back to semantic guesses when its schema is not ready", async () => {
  const h = fixture();
  try {
    h.db.exec("ALTER TABLE akyos DROP COLUMN urlUpdatedAt");
    const response = await worker.fetch(new Request("https://worker.test/search", {
      method: "POST", body: JSON.stringify({ query: "最新のAkyo" }),
    }), h.env);
    assert.equal(response.status, 503);
    assert.match((await response.json() as { error: string }).error, /completed catalog sync/);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
    assert.equal((await search(h.env, { query: "Item2030Akyo" })).results[0].id, "2030");
  } finally { h.db.close(); }
});

test("legacy ingestion preserves the sync-owned timestamp and still works on the old schema", async () => {
  const h = fixture();
  const row = { id: "2030", nickname: "EditedAkyo", language: "ja" };
  try {
    assert.equal((await ingestRecords([row], h.env)).processed, 1);
    assert.equal((h.db.prepare("SELECT urlUpdatedAt FROM akyos WHERE id = '2030'").all()[0] as { urlUpdatedAt: string }).urlUpdatedAt,
      "2026-10-01T00:00:00Z");
    h.db.exec("ALTER TABLE akyos DROP COLUMN urlUpdatedAt");
    assert.equal((await ingestRecords([row], h.env)).processed, 1);
  } finally { h.db.close(); }
});
