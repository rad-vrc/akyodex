import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";
import { reserveBudget, finishBudget, BudgetStoppedError, CHAT_MODEL } from "../../../scripts/ai-budget.js";
import { createCloudflareClient } from "../../../scripts/ai-catalog-cloudflare.js";
import { budgetQuery, embedBudgeted } from "./budgeted-ai";
import worker from "./index";
import type { D1Database, Env } from "./types";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");

describe("shared AI budget against real D1", () => {
  let runtime: { getD1Database(name: string): Promise<D1Database>; dispose(): Promise<void> };
  let db: D1Database;
  let env: Env;
  let calls: Parameters<Env["AI"]["run"]>[];
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).run();
  const total = async () => (await db.prepare("SELECT SUM(units) AS units FROM ai_budget_reservations").first<{ units: number }>())?.units ?? 0;
  before(async () => {
    runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true,
      script: "export default {fetch() {return new Response('local only')}};",
      compatibilityDate: "2025-11-09", cf: false, d1Databases: { DB: "budget-tests" },
      outboundService: () => new Response("Disabled", { status: 403 }) }), telemetry: { enabled: false } });
    db = await runtime.getD1Database("DB");
    const schema = readFileSync(new URL("../sql/ai-budget.sql", import.meta.url), "utf8");
    for (const statement of schema.split(";").filter(sql => sql.trim())) await run(statement);
    await run(`CREATE TABLE akyos (id TEXT PRIMARY KEY, publicId TEXT, entryType TEXT,
      nickname TEXT, name TEXT, category TEXT, description TEXT, author TEXT, url TEXT,
      language TEXT, urlUpdatedAt TEXT)`);
    await run(`INSERT INTO akyos VALUES ('2020', 'Avatar0001', 'avatar', 'OriginAkyo', 'OriginAkyo',
      'Color/Blue', '', 'Test', 'https://example.invalid/avatar/a', 'en', '')`);
  });
  after(async () => { await runtime?.dispose(); });
  beforeEach(async () => {
    await run("DELETE FROM ai_budget_reservations");
    await run("UPDATE ai_budget_config SET enabled = 1, limit_neurons = 8000");
    calls = [];
    env = { DB: db, CHAT_TOKEN: "fake-chat", INGEST_TOKEN: "fake-ingest", AI: { async run(model, input) {
      calls.push([model, input]);
      return "text" in input ? { data: (Array.isArray(input.text) ? input.text : [input.text]).map(() => [1, 2]) }
        : { choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 2000, completion_tokens: 500 } };
    } }, VECTORIZE: { async query() { return { matches: [] }; }, async upsert() {} } };
  });
  const request = (path: string, body: object, token = "fake-chat") => worker.fetch(new Request(`https://test.invalid${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env);
  const chat = (body: object = {}, token?: string) => request("/v1/chat/completions", {
    model: CHAT_MODEL, messages: [{ role: "user", content: "Hello" }], ...body,
  }, token);

  it("serializes concurrent reservations and permits exactly the remaining amount", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 24 }, () => reserveBudget(budgetQuery(db), 800)));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 10);
    assert.equal(await total(), 8000);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
  });
  it("installs disabled, enforces the maximum ceiling and never resets an existing ledger", async () => {
    await run("DELETE FROM ai_budget_config");
    const schema = readFileSync(new URL("../sql/ai-budget.sql", import.meta.url), "utf8");
    const install = async () => {
      for (const sql of schema.split(";").filter(sql => sql.trim())) await run(sql);
    };
    await install();
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
    await assert.rejects(run("UPDATE ai_budget_config SET limit_neurons = 8001"));
    await run("UPDATE ai_budget_config SET enabled = 1, limit_neurons = 65");
    await reserveBudget(budgetQuery(db), 65);
    await install();
    assert.equal(await total(), 65);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
  });
  it("never expires pending calls, even across midnight or a long outage", async () => {
    const id = await reserveBudget(budgetQuery(db), 8000);
    await run("UPDATE ai_budget_reservations SET created_at = unixepoch() - 864000 WHERE id = ?", id);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
    await finishBudget(budgetQuery(db), id, 8000);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
    await run("UPDATE ai_budget_reservations SET completed_at = unixepoch() - 86401 WHERE id = ?", id);
    await reserveBudget(budgetQuery(db), 8000);
  });
  it("settles once, cannot increase/refund twice, and ages from completion rather than start", async () => {
    const id = await reserveBudget(budgetQuery(db), 800);
    await run("UPDATE ai_budget_reservations SET created_at = unixepoch() - 864000 WHERE id = ?", id);
    await finishBudget(budgetQuery(db), id, 30);
    await finishBudget(budgetQuery(db), id, 1);
    assert.equal(await total(), 30);
    await reserveBudget(budgetQuery(db), 7970);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
  });
  it("disabling the ledger or losing it blocks both model routes before invocation", async () => {
    await run("UPDATE ai_budget_config SET enabled = 0");
    await assert.rejects(embedBudgeted("test", env), BudgetStoppedError);
    assert.match(JSON.stringify(await (await chat()).json()), /AI/);
    assert.equal(calls.length, 0);
    env.DB = { prepare() { throw new Error("DB unavailable"); }, async batch() { throw new Error("DB unavailable"); } };
    await assert.rejects(embedBudgeted("test", env), BudgetStoppedError);
    assert.equal((await chat()).status, 200);
    assert.equal(calls.length, 0);
  });
  it("leaves number, latest, exact name and count lookups usable with no budget", async () => {
    await reserveBudget(budgetQuery(db), 8000);
    for (const query of ["#Avatar0001", "latest Akyo", "OriginAkyo"]) {
      const response = await request("/search", { query, language: "en" });
      const body = await response.json() as { count: number; budgetLimited?: boolean };
      assert.equal(response.status, 200); assert.equal(body.count, 1); assert.equal(body.budgetLimited, undefined);
    }
    assert.equal((await request("/count", { author: "Test" })).status, 200);
    const discovery = await (await request("/search", { query: "cute", language: "en" })).json() as { budgetLimited: boolean; directAnswer: string };
    assert.equal(discovery.budgetLimited, true);
    assert.match(discovery.directAnswer, /budget/);
    const ingest = await request("/insert-data", { records: [{ id: "2", nickname: "Other" }] }, "fake-ingest");
    assert.equal((await ingest.json() as { failed: number }).failed, 1);
    assert.equal(calls.length, 0);
  });
  it("authenticates and validates generation before reserving or invoking AI", async () => {
    assert.equal((await chat({}, "wrong")).status, 401);
    for (const bad of [{ model: "expensive" }, { n: 2 }, { tools: [] }, { messages: [] },
      { messages: [{ role: "user", content: [{ text: "image" }] }] }, { max_tokens: -1 },
      { messages: [{ role: "user", content: "x".repeat(65536) }] }, { temperature: 3 }, { top_p: -1 }]) {
      assert.equal((await chat(bad)).status, 400);
    }
    env.CHAT_TOKEN = undefined;
    assert.equal((await chat()).status, 503);
    assert.equal(calls.length, 0); assert.equal(await total(), 0);
  });
  it("caps generation and settles actual usage before emitting JSON or SSE", async () => {
    for (const stream of [false, true]) {
      const response = await chat({ stream, max_tokens: 100000, usage: { prompt_tokens: 0 },
        temperature: 0.2, top_p: 0.75, frequency_penalty: 0.5, presence_penalty: 0.5 });
      const result = await response.text();
      assert.match(result, /Answer/);
      if (stream) assert.match(result, /data: \[DONE\]/);
      const input = calls.at(-1)![1];
      assert.ok("messages" in input);
      assert.equal(input.stream, false); assert.equal(input.n, 1); assert.equal(input.max_completion_tokens, 1024);
      assert.equal(input.temperature, 0.2); assert.equal(input.top_p, 0.75);
      assert.equal(input.frequency_penalty, 0.5); assert.equal(input.presence_penalty, 0.5);
    }
    assert.equal(await total(), 60);
  });
  it("keeps the full hold on errors, retries and malformed responses", async () => {
    env.AI.run = async () => { calls.push(["failure", { text: "" }]); throw new Error("upstream private"); };
    assert.equal((await chat()).status, 502);
    assert.equal((await chat()).status, 502);
    assert.equal(calls.length, 2); assert.equal(await total(), 1600);
    env.AI.run = async () => ({ choices: [] });
    assert.equal((await chat()).status, 502);
    assert.equal(await total(), 2400);
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE completed_at IS NULL").first<{ n: number }>();
    assert.equal(pending?.n, 3);
  });
  it("does not generate a budget warning using the model, including streaming callers", async () => {
    await reserveBudget(budgetQuery(db), 8000);
    assert.match(await (await chat({ stream: true })).text(), /data: \[DONE\]/);
    assert.equal(calls.length, 0); assert.equal(await total(), 8000);
  });
  it("holds budget while real handlers are in flight and rejects an eleventh completion", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tenStarted = new Promise<void>(resolve => { started = resolve; });
    env.AI.run = async (model, input) => {
      calls.push([model, input]);
      if (calls.length === 10) started();
      await gate;
      return { choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2000, completion_tokens: 500 } };
    };
    const pending = Array.from({ length: 10 }, () => chat());
    try {
      await tenStarted;
      assert.equal(await total(), 8000);
      assert.doesNotMatch(await (await chat()).text(), /"content":"Answer"/);
      assert.equal(calls.length, 10);
    } finally { release(); await Promise.all(pending); }
    assert.equal(await total(), 300);
    assert.match(await (await chat()).text(), /Answer/);
  });
  it("charges the full bound when completed inference does not report verifiable usage", async () => {
    env.AI.run = async () => ({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }] });
    assert.equal((await chat()).status, 200);
    assert.equal(await total(), 800);
    const row = await db.prepare("SELECT completed_at FROM ai_budget_reservations").first<{ completed_at: number }>();
    assert.equal(typeof row?.completed_at, "number");
  });
  it("shares the same atomic ledger with the real sync client, not just the Worker", async () => {
    let upstream = 0;
    const api = createCloudflareClient({ accountId: "test", databaseId: "test", indexName: "test", token: "fake",
      retryDelayMs: 0, fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/query")) {
          const body = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
          const result = await db.prepare(body.sql).bind(...body.params).all();
          return Response.json({ success: true, result: [result] });
        }
        upstream++;
        return Response.json({ success: true, result: { data: [[1, 2]] } });
      } });
    await reserveBudget(budgetQuery(db), 7870);
    await api.embed([{ nickname: "Sync" }]);
    await embedBudgeted("Search", env);
    await assert.rejects(api.embed([{ nickname: "Denied" }]), BudgetStoppedError);
    await assert.rejects(embedBudgeted("Denied", env), BudgetStoppedError);
    assert.equal(upstream, 1); assert.equal(calls.length, 1); assert.equal(await total(), 8000);
  });
});
