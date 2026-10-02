import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";
import { reserveBudget, finishBudget, BudgetStoppedError, CHAT_MODEL, embeddingReservation } from "../../../scripts/ai-budget.js";
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
  let calls: Array<[string, Parameters<Env["AI"]["run"]>[1]]>;
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
    env = { DB: db, CHAT_TOKEN: "fake-chat", INGEST_TOKEN: "fake-ingest", AI: { async run(model, input, options) {
      assert.deepEqual(options, { returnRawResponse: true });
      calls.push([model, input]);
      return Response.json("text" in input ? { data: (Array.isArray(input.text) ? input.text : [input.text]).map(() => [1, 2]) }
        : { choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 2000, completion_tokens: 500 } });
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
  it("never expires unacknowledged calls without proof of completion, even across midnight", async () => {
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

  it("imports cutover usage only while disabled, never duplicates or reduces it", async () => {
    const template = readFileSync(new URL("../sql/ai-budget-carry.sql", import.meta.url), "utf8");
    await assert.rejects(run(template), "unreviewed placeholder must not import a guessed amount");
    const carry = (units: number) => db.prepare(template.replace("REPLACE_WITH_VERIFIED_NEURONS", String(units)))
      .all<{ id: string; units: number; completed_at: number }>();
    assert.equal((await carry(137)).results?.length, 0, "enabled ledger refuses cutover imports");
    await run("UPDATE ai_budget_config SET enabled = 0");
    for (const bad of [0, -1, 8001, 1.5]) await assert.rejects(carry(bad));
    const first = await carry(137);
    assert.equal(first.results?.[0].units, 137);
    assert.equal(typeof first.results?.[0].completed_at, "number");
    await carry(137); await carry(99);
    assert.equal(await total(), 137);
    await carry(200);
    assert.equal(await total(), 200);
    await run("UPDATE ai_budget_reservations SET completed_at = unixepoch() - 86401");
    await carry(137);
    await run("UPDATE ai_budget_config SET enabled = 1");
    await reserveBudget(budgetQuery(db), 7800);
    await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
    await run("UPDATE ai_budget_config SET enabled = 0");
    await run("UPDATE ai_budget_reservations SET completed_at = NULL WHERE id = 'unguarded-cutover-v1'");
    assert.equal((await carry(200)).results?.length, 0, "never turn an uncertain hold into an expired charge");
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
  it("retains lost-response holds but completes malformed responses at full cost", async () => {
    env.AI.run = async () => { calls.push(["failure", { text: "" }]); throw new Error("upstream private"); };
    assert.equal((await chat()).status, 502);
    assert.equal((await chat()).status, 502);
    assert.equal(calls.length, 2); assert.equal(await total(), 1600);
    env.AI.run = async () => Response.json({ choices: [] });
    assert.equal((await chat()).status, 502);
    assert.equal(await total(), 2400);
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE completed_at IS NULL").first<{ n: number }>();
    assert.equal(pending?.n, 2);
  });
  it("does not generate a budget warning using the model, including streaming callers", async () => {
    await reserveBudget(budgetQuery(db), 8000);
    assert.match(await (await chat({ stream: true })).text(), /data: \[DONE\]/);
    assert.equal(calls.length, 0); assert.equal(await total(), 8000);
  });
  it("holds budget while real handlers are in flight and rejects an eleventh completion", { timeout: 15000 }, async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tenStarted = new Promise<void>(resolve => { started = resolve; });
    env.AI.run = async (model, input) => {
      calls.push([model, input]);
      if (calls.length === 10) started();
      await gate;
      return Response.json({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2000, completion_tokens: 500 } });
    };
    const pending = Array.from({ length: 10 }, () => chat());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([tenStarted, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Ten reserved calls did not start")), 5000);
      })]);
      assert.equal(await total(), 8000);
      assert.doesNotMatch(await (await chat()).text(), /"content":"Answer"/);
      assert.equal(calls.length, 10);
    } finally { clearTimeout(timer); release(); await Promise.all(pending); }
    assert.equal(await total(), 300);
    assert.match(await (await chat()).text(), /Answer/);
  });
  it("charges the full bound when completed inference does not report verifiable usage", async () => {
    env.AI.run = async () => Response.json({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }] });
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
    await reserveBudget(budgetQuery(db), 7998);
    await api.embed([{ nickname: "Sync" }]);
    await embedBudgeted("Search", env);
    await assert.rejects(api.embed([{ nickname: "Denied" }]), BudgetStoppedError);
    await assert.rejects(embedBudgeted("Denied", env), BudgetStoppedError);
    assert.equal(upstream, 1); assert.equal(calls.length, 1); assert.equal(await total(), 8000);
  });

  it("completes HTTP errors and unusable bodies at full cost and recovers after 24 hours", async () => {
    for (const makeResponse of [
      () => new Response("provider unavailable", { status: 503 }),
      () => new Response("invalid JSON", { status: 200 }),
      () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
    ]) {
      await run("DELETE FROM ai_budget_reservations");
      env.AI.run = async () => makeResponse();
      for (let i = 0; i < 10; i++) assert.equal((await chat()).status, 502);
      assert.equal(await total(), 8000);
      assert.equal((await chat()).status, 200, "the next call receives a fixed budget notice");
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE completed_at IS NULL").first<{ n: number }>())?.n, 0);
      await assert.rejects(reserveBudget(budgetQuery(db), 1), BudgetStoppedError);
      await run("UPDATE ai_budget_reservations SET completed_at = unixepoch() - 86401");
      await reserveBudget(budgetQuery(db), 8000);
    }
  });

  it("charges completed embedding failures but retains interrupted bodies", async () => {
    for (const makeResponse of [() => new Response("unavailable", { status: 503 }),
      () => new Response("bad JSON"), () => Response.json({ data: [] })]) {
      env.AI.run = async () => makeResponse();
      await assert.rejects(embedBudgeted("test", env));
    }
    env.AI.run = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("lost body")); } }));
    await assert.rejects(embedBudgeted("test", env));
    assert.equal(await total(), 4);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE completed_at IS NULL").first<{ n: number }>())?.n, 1);
  });

  it("permits 500 short searches and still has room for generation", { timeout: 30000 }, async () => {
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 50 }, () => embedBudgeted("cute blue avatar", env)));
    }
    assert.equal(calls.length, 500);
    assert.equal(await total(), 500);
    assert.match(await (await chat()).text(), /Answer/);
    assert.equal(await total(), 530);
  });

  it("keeps D1 partial matches when embedding is budget-limited", async () => {
    await reserveBudget(budgetQuery(db), 8000);
    const body = await (await request("/search", { query: "Blue", language: "en" })).json() as { count: number; results: { id: string }[]; budgetLimited?: boolean };
    assert.equal(body.count, 1);
    assert.equal(body.results[0].id, "2020");
    assert.equal(body.budgetLimited, true);
    assert.equal(calls.length, 0);
  });

  it("rejects oversized search input before any inference or reservation", async () => {
    for (const body of [{ query: "x".repeat(4097) }, { keywords: ["x".repeat(4097)] },
      { query: "latest", keywords: Array(25).fill("x") }, { query: "\u3042".repeat(1366) }]) {
      assert.equal((await request("/search", body)).status, 400);
    }
    assert.equal(calls.length, 0); assert.equal(await total(), 0);
    assert.equal((await request("/search", { query: "x".repeat(4096) })).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(await total(), embeddingReservation(["x".repeat(4096)]));
  });

  it("bounds search after compatibility expansion without changing the text sent to AI", async () => {
    const expanded = "\uFDFA".repeat(1364);
    assert.ok(new TextEncoder().encode(expanded).length < 4096);
    for (const body of [{ query: expanded }, { keywords: [expanded, expanded, expanded] }]) {
      assert.equal((await request("/search", body)).status, 400);
    }
    assert.equal(calls.length, 0); assert.equal(await total(), 0);
    const text = "\uFDFA".repeat(20);
    assert.equal((await request("/search", { query: text })).status, 200);
    assert.deepEqual(calls[0][1], { text });
  });

  it("does not mark an ordinary discovery result as budget-limited", async () => {
    const body = await (await request("/search", { query: "Blue", language: "en" })).json() as { budgetLimited?: boolean };
    assert.equal(body.budgetLimited, undefined);
    assert.equal(calls.length, 1);
  });

  it("logs only uncertain holds with their ledger IDs, never input or upstream errors", async t => {
    const warnings = t.mock.method(console, "warn", () => {});
    for (const bodyLost of [false, true]) {
      env.AI.run = async () => {
        if (!bodyLost) throw new Error("PRIVATE_UPSTREAM");
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE_BODY")); } }));
      };
      assert.equal((await chat({ messages: [{ role: "user", content: "PRIVATE_QUESTION" }] })).status, 502);
      await assert.rejects(embedBudgeted("PRIVATE_CATALOG", env));
    }
    env.AI.run = async () => new Response("invalid JSON");
    assert.equal((await chat()).status, 502);
    await assert.rejects(embedBudgeted("test", env));
    const logs = warnings.mock.calls.map(call => JSON.parse(String(call.arguments[0])) as { event: string; reason: string; reservationId: string; units: number });
    assert.equal(logs.length, 4, "only transport/body loss keeps an uncertain hold");
    const pending = await db.prepare("SELECT id, units FROM ai_budget_reservations WHERE completed_at IS NULL").all<{ id: string; units: number }>();
    assert.deepEqual(logs.map(log => ({ id: log.reservationId, units: log.units })).sort((a, b) => a.id.localeCompare(b.id)),
      pending.results!.sort((a, b) => a.id.localeCompare(b.id)));
    for (const log of logs) {
      assert.equal(log.event, "ai_budget_hold"); assert.equal(log.reason, "response_lost");
    }
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|fake-chat|fake-ingest/);
  });

  for (const path of ["/v1/chat/completions", "/search", "/insert-data"]) {
    it(`keeps ${path} registered through inference and settlement after caller abort`, { timeout: 10000 }, async () => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      const original = env.AI.run;
      env.AI.run = async (...args) => { started(); await gate; return original(...args); };
      const controller = new AbortController();
      const lifetime: Promise<unknown>[] = [];
      const body = path === "/search" ? { query: "Blue", language: "en" }
        : path === "/insert-data" ? { records: [{ id: "2", nickname: "New", language: "en" }] }
        : { model: CHAT_MODEL, messages: [{ role: "user", content: "Hello" }] };
      const response = worker.fetch(new Request(`https://test.invalid${path}`, { method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${path === "/insert-data" ? "fake-ingest" : "fake-chat"}` }, body: JSON.stringify(body) }),
      env, { waitUntil(promise: Promise<unknown>) { lifetime.push(promise); } });
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([entered, new Promise((_, reject) => {
          startupTimer = setTimeout(() => reject(new Error("Inference did not start")), 5000);
        })]);
        clearTimeout(startupTimer);
        assert.equal(lifetime.length, 1, "register before inference finishes, not just before the SQL write");
        let settled = false;
        void lifetime[0].then(() => { settled = true; });
        controller.abort();
        await Promise.resolve();
        assert.equal(settled, false);
      } finally { clearTimeout(startupTimer); release(); await response; await Promise.all(lifetime); }
      assert.equal(calls.length, 1, "keeping a promise alive must not start inference twice");
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE completed_at IS NULL").first<{ n: number }>())?.n, 0);
      assert.equal(await total(), path === "/v1/chat/completions" ? 30 : 1);
    });
  }
});
