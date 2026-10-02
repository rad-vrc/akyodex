import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CHAT_MODEL } from "../../../scripts/ai-budget.js";
import type { D1Database } from "./types";

const require = createRequire(import.meta.url);
const requireFromWrangler = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireFromWrangler("miniflare");
const { buildSync } = requireFromWrangler("esbuild");

// Runtime smoke test only: local workerd can also continue without waitUntil.
// ai-budget.test.ts separately asserts registration before upstream completion.
test("workerd settles after a real HTTP client disconnect while upstream is still running", { timeout: 15000 }, async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let aiCalls = 0;
  const script = buildSync({ stdin: {
    contents: `import worker from './index.ts';
      export default { fetch(request, env, ctx) {
        return worker.fetch(request, { ...env,
          AI: { run: () => fetch('https://provider.invalid/ai') }
        }, ctx);
      } };`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
  }, bundle: true, format: "esm", platform: "browser", write: false }).outputFiles[0].text;
  const runtime: { ready: Promise<URL>; getD1Database(name: string): Promise<D1Database>; dispose(): Promise<void> } =
    new Miniflare({ ...convertV4MiniflareOptions({
      script, modules: true, compatibilityDate: "2025-11-09", cf: false,
      d1Databases: { DB: "lifetime-test" }, bindings: { CHAT_TOKEN: "fake-chat" },
      outboundService: async (request: Request) => {
        assert.equal(request.url, "https://provider.invalid/ai");
        aiCalls++; started(); await gate;
        return Response.json({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2000, completion_tokens: 500 } });
      },
    }), telemetry: { enabled: false } });
  const controller = new AbortController();
  let response: Promise<Response> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync(new URL("../sql/ai-budget.sql", import.meta.url), "utf8");
    for (const sql of schema.split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
    await db.prepare("UPDATE ai_budget_config SET enabled = 1").run();
    response = fetch(new URL("/v1/chat/completions", await runtime.ready), {
      method: "POST", signal: controller.signal, headers: { Authorization: "Bearer fake-chat", "Content-Type": "application/json" },
      body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: "user", content: "Hello" }] }),
    });
    const disconnected = assert.rejects(response, { name: "AbortError" });
    await Promise.race([entered, new Promise((_, reject) => {
      startupTimer = setTimeout(() => reject(new Error("Inference did not start")), 5000);
    })]);
    clearTimeout(startupTimer);
    controller.abort(); await disconnected;
    // Allow the HTTP disconnect to reach workerd before completing the fake provider.
    await delay(100);
    release();
    type LedgerRow = { units: number; completed_at: number | null };
    let row: LedgerRow | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      row = await db.prepare("SELECT units, completed_at FROM ai_budget_reservations").first<LedgerRow>();
      if (row?.completed_at !== null && row?.completed_at !== undefined) break;
      await delay(20);
    }
    assert.equal(row?.units, 30, "actual provider usage must settle after the client is gone");
    assert.equal(typeof row?.completed_at, "number");
    assert.equal(aiCalls, 1);
  } finally {
    clearTimeout(startupTimer);
    controller.abort(); release();
    await response?.catch(() => {});
    await runtime.dispose();
  }
});
