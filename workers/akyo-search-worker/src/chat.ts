import { CHAT_MODEL, CHAT_RESERVATION, MAX_COMPLETION_TOKENS, BudgetStoppedError,
  reserveBudget, finishBudget, chatCharge } from "../../../scripts/ai-budget.js";
import { budgetQuery, readAIResponse } from "./budgeted-ai";
import { isAuthorizedForIngest } from "./ingest";
import { normalizeLanguage } from "./search";
import type { Env, Language } from "./types";

export function budgetNotice(language: Language): string {
  return {
    ja: "AIの利用上限に達したか、予算を確認できないため、AI処理を停止しています。番号・名前・最新・件数の検索は引き続き使えます。時間を置いてお試しください。",
    en: "AI is paused because its budget is exhausted or unavailable. Number, name, latest and count lookups remain available. Please try again later.",
    ko: "AI 이용 한도에 도달했거나 예산을 확인할 수 없어 AI 처리를 중지했습니다. 번호, 이름, 최신 및 개수 검색은 계속 사용할 수 있습니다. 나중에 다시 시도해 주세요.",
  }[language];
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: { message, type: "invalid_request_error" } }, { status });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error("Request exceeds 64 KiB"); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function completion(content: string, stream: boolean, finishReason = "stop") {
  const base = { id: `chatcmpl-${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), model: CHAT_MODEL };
  if (!stream) return Response.json({ ...base, object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }] });
  // Buffer upstream so usage is settled before returning even if Dify disconnects.
  const event = (choices: unknown[]) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices })}\n\n`;
  return new Response(event([{ index: 0, delta: { role: "assistant", content }, finish_reason: null }]) +
    event([{ index: 0, delta: {}, finish_reason: finishReason }]) + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!env.CHAT_TOKEN) return errorResponse("Chat proxy is not configured", 503);
  if (!await isAuthorizedForIngest(request, env.CHAT_TOKEN)) return errorResponse("Unauthorized", 401);
  let body: unknown;
  try { body = await boundedJson(request); } catch { return errorResponse("Invalid or oversized JSON body", 400); }
  if (!isObject(body) || body.model !== CHAT_MODEL || !Array.isArray(body.messages) ||
    body.messages.length < 1 || body.messages.length > 24 ||
    (body.n !== undefined && body.n !== 1) || body.tools !== undefined || body.functions !== undefined ||
    (body.stream !== undefined && typeof body.stream !== "boolean")) {
    return errorResponse("Unsupported model, messages or generation options", 400);
  }
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  for (const message of body.messages) {
    if (!isObject(message) || !["system", "user", "assistant"].includes(String(message.role)) ||
      typeof message.content !== "string") return errorResponse("Only text messages are supported", 400);
    messages.push({ role: message.role as "system" | "user" | "assistant", content: message.content });
  }
  const requestedTokens = body.max_completion_tokens ?? body.max_tokens ?? MAX_COMPLETION_TOKENS;
  if (typeof requestedTokens !== "number" || !Number.isSafeInteger(requestedTokens) || requestedTokens <= 0) {
    return errorResponse("Invalid completion limit", 400);
  }
  const sampling: Partial<Record<"temperature" | "top_p" | "frequency_penalty" | "presence_penalty", number>> = {};
  for (const [key, min, max] of [["temperature", 0, 2], ["top_p", 0, 1],
    ["frequency_penalty", -2, 2], ["presence_penalty", -2, 2]] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      return errorResponse("Invalid sampling parameter", 400);
    }
    sampling[key] = value;
  }
  const stream = body.stream === true;
  const query = budgetQuery(env.DB);
  let id: string;
  try { id = await reserveBudget(query, CHAT_RESERVATION); }
  catch (error) {
    if (!(error instanceof BudgetStoppedError)) throw error;
    const language = normalizeLanguage(undefined, messages.filter(message => message.role === "user").at(-1)?.content ?? "");
    return completion(budgetNotice(language), stream);
  }
  try {
    // Never forward model, tools, n, stream or token limits unchecked.
    const response = await env.AI.run(CHAT_MODEL, { ...sampling, messages, n: 1, stream: false,
      max_completion_tokens: Math.min(requestedTokens, MAX_COMPLETION_TOKENS) }, { returnRawResponse: true });
    const result = await readAIResponse(response, () => finishBudget(query, id, CHAT_RESERVATION));
    if (!isObject(result) || !Array.isArray(result.choices) || result.choices.length !== 1) {
      await finishBudget(query, id, CHAT_RESERVATION);
      throw new Error("Invalid completion");
    }
    const choice: unknown = result.choices[0];
    if (!isObject(choice) || !isObject(choice.message) || typeof choice.message.content !== "string" || !choice.message.content.trim() ||
      !["stop", "length"].includes(String(choice.finish_reason))) {
      await finishBudget(query, id, CHAT_RESERVATION);
      throw new Error("Invalid completion");
    }
    await finishBudget(query, id, chatCharge(result.usage));
    return completion(choice.message.content, stream, String(choice.finish_reason));
  } catch {
    // No refund or hidden retry. Complete errors age out; lost responses stay held.
    return errorResponse("AI generation failed; please try again later", 502);
  }
}
