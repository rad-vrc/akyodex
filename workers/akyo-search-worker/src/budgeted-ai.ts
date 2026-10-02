import { EMBEDDING_MODEL, embeddingReservation, reserveBudget, finishBudget, reportBudgetHold } from "../../../scripts/ai-budget.js";
import type { D1Database, Env } from "./types";

export function budgetQuery(db: D1Database) {
  return async (sql: string, params: unknown[]) => {
    const result = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    if (result.success !== true || !Array.isArray(result.results)) throw new Error("AI ledger write failed");
    return result.results;
  };
}

// A complete response (even an HTTP error or invalid JSON) is terminal. A lost
// connection/body is uncertain: retain that hold, never release it on a timer.
export async function readAIResponse(run: () => Promise<Response>, onCompleted: () => Promise<void>,
  reservation: { id: string; units: number }): Promise<unknown> {
  let response: Response;
  let body: string;
  try {
    response = await run();
    body = await response.text();
  } catch {
    reportBudgetHold(reservation.id, reservation.units, "response_lost");
    throw new Error("AI response lost; reservation retained");
  }
  if (!response.ok) {
    await onCompleted();
    throw new Error("AI upstream returned an error");
  }
  try { return JSON.parse(body); }
  catch {
    await onCompleted();
    throw new Error("Invalid AI response JSON");
  }
}

export async function embedBudgeted(text: string | string[], env: Env): Promise<{ data: number[][] }> {
  const texts = typeof text === "string" ? [text] : text;
  const units = embeddingReservation(texts);
  const query = budgetQuery(env.DB);
  const id = await reserveBudget(query, units);
  const result = await readAIResponse(() => env.AI.run(EMBEDDING_MODEL, { text }, { returnRawResponse: true }),
    () => finishBudget(query, id, units), { id, units });
  // Complete but unusable responses are charged too, and age out normally.
  await finishBudget(query, id, units);
  if (!result || typeof result !== "object" || !("data" in result) || !Array.isArray(result.data) ||
    result.data.length !== texts.length || result.data.some(vector => !Array.isArray(vector) ||
      vector.length === 0 || vector.some(value => typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error("Invalid embedding response");
  }
  return { data: result.data };
}
