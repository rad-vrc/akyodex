import { EMBEDDING_MODEL, embeddingReservation, reserveBudget, finishBudget } from "../../../scripts/ai-budget.js";
import type { D1Database, Env } from "./types";

export function budgetQuery(db: D1Database) {
  return async (sql: string, params: unknown[]) => {
    const result = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    if (result.success !== true || !Array.isArray(result.results)) throw new Error("AI ledger write failed");
    return result.results;
  };
}

export async function embedBudgeted(text: string | string[], env: Env): Promise<{ data: number[][] }> {
  const texts = typeof text === "string" ? [text] : text;
  const units = embeddingReservation(texts);
  const query = budgetQuery(env.DB);
  const id = await reserveBudget(query, units);
  const result = await env.AI.run(EMBEDDING_MODEL, { text });
  if (!result || typeof result !== "object" || !("data" in result) || !Array.isArray(result.data) ||
    result.data.length !== texts.length || result.data.some(vector => !Array.isArray(vector) ||
      vector.length === 0 || vector.some(value => typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error("Invalid embedding response");
  }
  await finishBudget(query, id, units);
  return { data: result.data };
}
