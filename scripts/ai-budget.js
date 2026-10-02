// Neurons, rounded up per request. Re-audit with any model/tokenizer/price change.
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
const CHAT_RESERVATION = 800;
const MAX_COMPLETION_TOKENS = 1024;

class BudgetStoppedError extends Error {
  constructor() { super('AI budget unavailable or exhausted'); this.name = 'BudgetStoppedError'; }
}

function embeddingReservation(texts) {
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 20 || texts.some(text =>
    typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > 65536)) {
    throw new Error('Invalid embedding input');
  }
  // BGE M3: XLM-R Unigram, no byte fallback, NFKC normalization, Metaspace,
  // and two special tokens. NFKD cannot be shorter than NFKC; UTF-16 length
  // bounds code points. Allow one extra prefix per character (including
  // segments split by literal special tokens), not an average tokens/word ratio.
  const tokens = texts.reduce((sum, text) => sum + Math.min(60000, 2 * text.normalize('NFKD').length + 2), 0);
  return Math.max(1, Math.ceil(tokens * 1075 / 1e6));
}

function chatCharge(usage) {
  if (!usage || !Number.isSafeInteger(usage.prompt_tokens) || usage.prompt_tokens <= 0 || usage.prompt_tokens > 131072 ||
    !Number.isSafeInteger(usage.completion_tokens) || usage.completion_tokens < 0 || usage.completion_tokens > MAX_COMPLETION_TOKENS) {
    return CHAT_RESERVATION;
  }
  return Math.max(1, Math.ceil((usage.prompt_tokens * 5500 + usage.completion_tokens * 36400) / 1e6));
}

/** @typedef {(sql: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>} BudgetQuery */

/** @param {BudgetQuery} query @param {number} units */
async function reserveBudget(query, units) {
  if (!Number.isSafeInteger(units) || units <= 0 || units > 8000) throw new BudgetStoppedError();
  const id = crypto.randomUUID();
  try {
    // One serialized D1 write: never a SELECT followed by an unconditional INSERT.
    // Pending calls do not expire: a disconnected caller cannot prove AI stopped.
    const rows = await query(`INSERT INTO ai_budget_reservations (id, units)
      SELECT ?, ? FROM ai_budget_config
      WHERE id = 1 AND enabled = 1 AND ? <= limit_neurons - (
        SELECT COALESCE(SUM(units), 0) FROM ai_budget_reservations
        WHERE completed_at IS NULL OR completed_at > unixepoch() - 86400
      ) RETURNING id`, [id, units, units]);
    if (rows.length !== 1 || rows[0].id !== id) throw new BudgetStoppedError();
    return id;
  } catch {
    throw new BudgetStoppedError();
  }
}

/** @param {BudgetQuery} query @param {string} id @param {number} units */
async function finishBudget(query, id, units) {
  if (!Number.isSafeInteger(units) || units <= 0 || units > 8000) throw new Error('Invalid AI charge');
  try {
    // Completion starts the 24-hour retention. First settlement wins; uncertain
    // responses keep their full pending reservation, including across retries.
    await query(`UPDATE ai_budget_reservations SET units = ?, completed_at = unixepoch()
      WHERE id = ? AND completed_at IS NULL AND units >= ? RETURNING id`, [units, id, units]);
  } catch {
    // A ledger outage must not refund a charge or discard a successful answer.
    console.warn('AI budget settlement failed; reservation retained');
  }
}

/** Check rollout readiness before modifying catalog rows; reservations still enforce the cap. */
async function assertBudgetReady(query) {
  try {
    const rows = await query(`SELECT enabled, limit_neurons - (
      SELECT COALESCE(SUM(units), 0) FROM ai_budget_reservations
      WHERE completed_at IS NULL OR completed_at > unixepoch() - 86400
    ) AS remaining FROM ai_budget_config WHERE id = 1`, []);
    if (rows.length !== 1 || rows[0].enabled !== 1 || !(Number(rows[0].remaining) > 0)) throw new BudgetStoppedError();
  } catch { throw new BudgetStoppedError(); }
}

module.exports = { EMBEDDING_MODEL, CHAT_MODEL, CHAT_RESERVATION, MAX_COMPLETION_TOKENS,
  BudgetStoppedError, embeddingReservation, chatCharge, reserveBudget, finishBudget, assertBudgetReady };
