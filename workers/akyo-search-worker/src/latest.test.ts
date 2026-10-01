import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectLatestEntries } from "../../../src/lib/akyo-entry";
import worker from "./index";
import { ingestRecords } from "./ingest";
import { isLatestRequest } from "./latest";
import { parseCatalogQuestion } from "./catalog-question";
import type { AkyoRecord, D1Database, D1PreparedStatement, Env } from "./types";

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

test("latest intent bounds raw queries and every keyword before whitespace normalization", () => {
  for (const gap of [" ", "\u3000", "\t", "\n", "\u00a0"]) {
    const atLimit = `最新${gap.repeat(58)}`;
    const overLimit = `${atLimit}${gap}`;
    assert.equal(isLatestRequest(atLimit, undefined), true, "60 code units are allowed");
    assert.equal(isLatestRequest(overLimit, ["latest"]), false, "an explicit long query must not fall back to keywords");
    assert.equal(isLatestRequest(undefined, [overLimit, "Akyo"]), false);
    assert.equal(isLatestRequest(undefined, ["最新", `${gap.repeat(57)}Akyo`]), false,
      "the catalog noun keyword must obey the same raw limit");
  }
  assert.equal(isLatestRequest(undefined, ["latest", "Akyo"]), true);
  assert.equal(isLatestRequest(" \t\n", ["latest"]), true, "blank queries still allow keyword-only requests");
});

test("latest intent normalizes bounded whitespace without dropping qualifications or negations", () => {
  for (const query of [
    "最新の\t\tAkyo\u3000を\n教えてください？",
    "What  is\tthe\u3000latest  Akyo?",
    "최근\u3000추가된\tAkyo\n알려  주세요",
  ]) assert.equal(isLatestRequest(query, undefined), true, query);
  for (const query of ["最新の  青いAkyo", "最新  ではないAkyo", "latest  blue Akyo", "최신  파란 아쿄"]) {
    assert.equal(isLatestRequest(query, ["latest"]), false, query);
  }
});

test("adversarial latest phrases finish without unbounded regex backtracking", () => {
  // A child process timeout can stop a synchronous regex; node:test's timeout cannot.
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, ["--require", require.resolve("tsx/cjs"), "-e", `
    const assert = require("node:assert/strict");
    const { isLatestRequest } = require(${JSON.stringify(require.resolve("./latest.ts"))});
    for (const prefix of ["最新", "최신", "latest"]) {
      for (const gap of [" ", "\\u3000", "\\t\\n"]) {
        for (const count of [800, 1600, 100000]) {
          const query = prefix + gap.repeat(count) + "x";
          assert.equal(isLatestRequest(query, ["latest"]), false);
          assert.equal(isLatestRequest(undefined, [query, "Akyo"]), false);
          assert.equal(isLatestRequest(undefined, ["latest", query]), false);
        }
      }
    }
  `], { timeout: 5000, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

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
  const aiInputs: (string | string[])[] = [];
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
    AI: { async run(_model, input) { aiCalls++; aiInputs.push(input.text); return { data: [[1, 2]] }; } },
    VECTORIZE: { async query() { vectorCalls++; return { matches: [] }; }, async upsert() {} },
  };
  return { db, env, data, aiInputs, counts: () => ({ aiCalls, vectorCalls }) };
}

async function search(env: Env, body: object) {
  const response = await worker.fetch(new Request("https://worker.test/search", {
    method: "POST", body: JSON.stringify(body),
  }), env);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ searchMode: string; count: number;
    query?: string;
    results: { id: string; entryType: string; language: string; urlUpdatedAt?: string }[] }>;
}

test("latest requests follow the same timestamp/internal-ID order as the catalog, without AI", async () => {
  const h = fixture();
  try {
    for (const body of [
      { query: "最新のakyoは？" }, { query: "最近追加されたAkyoを教えて" },
      { query: "最新のAkyoについて教えて" }, { query: "新着のAkyoを見せて" },
      { query: "新しいAkyoは？" }, { query: "最も新しいAkyoについて知りたい" },
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

test("numbered natural-language questions resolve the exact ID, not a semantic substitute", async () => {
  const h = fixture();
  try {
    for (const query of ["#0001のAkyoについて教えて", "#0001", "0001番のAkyoについて教えて", "#Avatar0001"]) {
      const result = await search(h.env, { query, keywords: ["Akyo"] });
      assert.equal(result.searchMode, "specific-name", query);
      assert.deepEqual(result.results.map(r => r.id), ["0001"], query);
    }
    assert.deepEqual((await search(h.env, { query: "#4321のAkyoについて教えて" })).results, []);
    assert.deepEqual((await search(h.env, { query: "Item2030Akyoを教えて" })).results.map(r => r.id), ["2030"]);
    assert.deepEqual((await search(h.env, { query: "MissingXYZAkyoを教えて" })).results, []);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  } finally { h.db.close(); }
});

test("catalog questions count and intersect exact conditions instead of returning semantic guesses", async () => {
  const h = fixture();
  try {
    h.db.exec("UPDATE akyos SET category = '色/青色系,対応機種/Quest(Android)', author = 'Holimond' WHERE id IN ('0001', '2030')");
    h.db.exec("UPDATE akyos SET category = '色/青色系' WHERE id = '0917'");
    h.db.exec("UPDATE akyos SET category = '対応機種/Quest(Android)', author = 'Holimond' WHERE id = '0002'");
    const request = async (query: string) => {
      const response = await worker.fetch(new Request("https://worker.test/search", {
        method: "POST", body: JSON.stringify({ query, language: "ja", topK: 1 }),
      }), h.env);
      assert.equal(response.status, 200);
      return response.json() as Promise<{ searchMode: string; total?: number; count: number; results: { id: string }[] }>;
    };
    for (const query of ["Quest対応のAkyoは何体ありますか？", "Holimondさんが作ったAkyoは何体ありますか？"]) {
      const result = await request(query);
      assert.equal(result.searchMode, "count", query);
      assert.equal(result.total, 2, "total is not the limited result count and excludes worlds");
      assert.equal(result.count, 1);
    }
    const combined = await request("青色でQuest対応のAkyoを3体教えて");
    assert.equal(combined.searchMode, "filtered");
    assert.deepEqual(combined.results.map(r => r.id), ["0001", "2030"]);
    assert.equal(combined.total, 2);
    const worlds = await request("Akyoのいるワールドを3つ教えて");
    assert.equal(worlds.searchMode, "filtered");
    assert.deepEqual(worlds.results.map(r => r.id), ["0002"]);
    for (const query of ["Quest非対応のAkyoを教えて", "青色か赤色のAkyoを教えて", "最新の青色のAkyoを教えて"]) {
      assert.equal((await request(query)).searchMode, "clarification", query);
    }
    assert.equal((await request("そのAkyoはQuestでも使えますか？")).searchMode, "needs-context");
    assert.equal((await request("Missingさんが作ったAkyoは何体ありますか？")).total, 0);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  } finally { h.db.close(); }
});

test("catalog answers render totals and exact records without asking an LLM to count examples", async () => {
  const h = fixture();
  try {
    h.db.exec("UPDATE akyos SET category = '色/青色系,対応機種/Quest(Android)', author = 'Holimond' WHERE id IN ('0001', '2030')");
    const request = async (query: string) => {
      const response = await worker.fetch(new Request("https://worker.test/search", {
        method: "POST", body: JSON.stringify({ query, topK: 1 }),
      }), h.env);
      return response.json() as Promise<{ directAnswer: string }>;
    };
    assert.equal((await request("Quest対応のAkyoは何体ありますか？")).directAnswer,
      "条件: 対応機種/Quest(Android)\n図鑑の該当するアバターは2体です。");
    assert.equal((await request("Missingさんが作ったAkyoは何体ありますか？")).directAnswer,
      "条件: 作者 Missing\n図鑑の該当するアバターは0体です。");
    const list = (await request("青色でQuest対応のAkyoを3体教えて")).directAnswer;
    assert.match(list, /該当するアバターは2体です。うち2体を紹介します/);
    assert.match(list, /1\. Item0001Akyo/);
    assert.match(list, /2\. Item2030Akyo/);
    assert.doesNotMatch(list, /Item0917|Item0002/);
    const worlds = (await request("Akyoのいるワールドを3つ教えて")).directAnswer;
    assert.match(worlds, /ワールドは1件/);
    assert.match(worlds, /https:\/\/vrchat.com\/home\/world\/wrld-example/);
    assert.doesNotMatch(worlds, /アバター/);
    assert.match((await request("そのAkyoはQuestでも使えますか？")).directAnswer, /どのAkyo/);
    assert.match((await request("Quest非対応のAkyoを教えて")).directAnswer, /条件を正確に読み取れません/);
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  } finally { h.db.close(); }
});

test("the latest guard leaves long queries intact for ordinary search", async () => {
  const h = fixture();
  try {
    const query = `最新${" ".repeat(800)}blue`;
    const result = await search(h.env, { query });
    assert.notEqual(result.searchMode, "latest");
    assert.equal(result.query, query);
    assert.deepEqual(h.aiInputs, [query], "ordinary semantic search receives the full query");
    const keywordsOnly = await search(h.env, { keywords: ["latest", `${" ".repeat(57)}Akyo`] });
    assert.notEqual(keywordsOnly.searchMode, "latest");
  } finally { h.db.close(); }
});

test("catalog question parser is bounded and never discards unknown or negative conditions", () => {
  for (const query of [undefined, null, 42, "Quest対応のAkyoは何体ありますか？" + " ".repeat(200)]) {
    assert.equal(parseCatalogQuestion(query), undefined);
  }
  for (const query of ["青色でQuest非対応のAkyoを3体教えて", "青色で小さいAkyoを3体教えて", "青色または赤色のAkyoを3体教えて"]) {
    assert.equal(parseCatalogQuestion(query)?.kind, "clarification", query);
  }
  for (const query of ["MenmeAkyoを教えて", "かわいいAkyoを教えて", "不存在Akyoを教えて"]) {
    assert.equal(parseCatalogQuestion(query), undefined, query);
  }
});

test("catalog counts use whole category tokens, exact bound author values and the Japanese catalog", async () => {
  const h = fixture();
  try {
    h.db.exec("UPDATE akyos SET category = '色/青色系,対応機種/Quest(Android)' WHERE id = '0001'");
    h.db.exec("UPDATE akyos SET category = '色/青色系/水色,対応機種/Quest(Android)' WHERE id = '0917'");
    h.db.exec("UPDATE akyos SET category = '色/青色系,対応機種/Quest(Android)旧名' WHERE id = '2030'");
    h.db.exec("UPDATE akyos SET category = 'Color/Blue,Platform/Quest', language = 'en' WHERE id = '9999'");
    const author = "O'Reilly_%";
    h.db.prepare("UPDATE akyos SET author = ? WHERE id = '0001'").run(author);
    h.db.prepare("UPDATE akyos SET author = ? WHERE id = '0917'").run(`${author} extra`);
    for (const [query, total, ids] of [
      ["青色でQuest対応のAkyoを3体教えて", 1, ["0001"]],
      [`${author}さんが作ったAkyoは何体ありますか？`, 1, ["0001"]],
      ["Quest対応のAkyoは何体ありますか？", 2, ["0001", "0917"]],
    ] as const) {
      const response = await worker.fetch(new Request("https://worker.test/search", {
        method: "POST", body: JSON.stringify({ query, language: "en", topK: 8 }),
      }), h.env);
      assert.equal(response.status, 200);
      const result = await response.json() as { language: string; total: number; results: { id: string }[] };
      assert.equal(result.language, "ja");
      assert.equal(result.total, total);
      assert.deepEqual(result.results.map(r => r.id), ids);
    }
    assert.deepEqual(h.counts(), { aiCalls: 0, vectorCalls: 0 });
  } finally { h.db.close(); }
});

test("real catalog questions agree with direct filtering of the synchronized source", async t => {
  const h = fixture();
  const { buildPayload } = createRequire(import.meta.url)("../../../scripts/generate-vectorize-payload.js") as {
    buildPayload(input: unknown): AkyoRecord[];
  };
  const rows = buildPayload(JSON.parse(readFileSync(new URL("../../../data/akyo-data-ja.json", import.meta.url), "utf8")));
  const avatar = (row: AkyoRecord) => row.entryType === "avatar";
  const quest = (row: AkyoRecord) => row.category.split(",").includes("対応機種/Quest(Android)");
  const blue = (row: AkyoRecord) => row.category.split(",").includes("色/青色系");
  try {
    h.db.exec("DELETE FROM akyos");
    for (const row of rows) h.db.prepare("INSERT INTO akyos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.nickname, row.name, row.category, row.description, row.author, row.url, row.language, row.urlUpdatedAt ?? "");
    for (const [query, expected, limit] of [
      ["Quest対応のAkyoは何体ありますか？", rows.filter(r => avatar(r) && quest(r)), 8],
      ["Holimondさんが作ったAkyoは何体ありますか？", rows.filter(r => avatar(r) && r.author === "Holimond"), 8],
      ["青色でQuest対応のAkyoを3体教えて", rows.filter(r => avatar(r) && blue(r) && quest(r)), 3],
      ["Akyoのいるワールドを3つ教えて", rows.filter(r => r.entryType === "world"), 3],
    ] as const) {
      const response = await worker.fetch(new Request("https://worker.test/search", {
        method: "POST", body: JSON.stringify({ query, topK: 8 }),
      }), h.env);
      assert.equal(response.status, 200);
      const result = await response.json() as { total: number; results: { id: string }[] };
      assert.equal(result.total, expected.length);
      assert.deepEqual(result.results.map(r => r.id), expected.map(r => r.id).sort().slice(0, limit));
      t.diagnostic(`${query}: total=${result.total}, returned=${result.results.map(r => r.id).join(",")}`);
    }
    const latest = await search(h.env, { query: "最新のAkyoについて教えて", topK: 8 });
    assert.deepEqual(latest.results.map(r => r.id), selectLatestEntries(rows, 8).map(r => r.id));
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
