import { isSpecificNameQuery, normalizeTopK } from "./search";
import { normalizeEntryType } from "./types";
import type { AkyoRecord, Env } from "./types";

interface CatalogQuestion {
  kind: "count" | "filtered";
  categories: string[];
  author?: string;
  entryType: "avatar" | "world";
  limit?: number;
}
type Question = CatalogQuestion | { kind: "clarification" } | { kind: "needs-context" }
  | { kind: "named"; name: string };

const CATEGORY_ALIASES = new Map([
  ["quest対応", "対応機種/Quest(Android)"],
  ["android対応", "対応機種/Quest(Android)"],
  ["pc対応", "対応機種/PC"],
  ["ios対応", "対応機種/iOS"],
  ["青", "色/青色系"], ["青色", "色/青色系"], ["青い", "色/青色系"],
  ["赤", "色/赤色系"], ["赤色", "色/赤色系"], ["赤い", "色/赤色系"],
  ["緑", "色/緑色系"], ["緑色", "色/緑色系"],
  ["白", "色/白色系"], ["白色", "色/白色系"], ["白い", "色/白色系"],
  ["黒", "色/黒色系"], ["黒色", "色/黒色系"], ["黒い", "色/黒色系"],
  ["黄", "色/黄色系"], ["黄色", "色/黄色系"], ["黄色い", "色/黄色系"],
  ["ピンク", "色/ピンク色系"], ["ピンク色", "色/ピンク色系"],
  ["紫", "色/紫色系"], ["紫色", "色/紫色系"],
  ["茶", "色/茶色系"], ["茶色", "色/茶色系"], ["茶色い", "色/茶色系"],
  ["虹色", "色/虹色系"], ["無彩色", "色/無彩色系"],
]);

// Only fully understood conditions earn an exact answer. Unknown list conditions
// keep ordinary discovery; unknown counts require clarification, not a guessed total.
export function parseCatalogQuestion(query: unknown): Question | undefined {
  if (typeof query !== "string" || query.length > 200) return undefined;
  const text = query.replace(/\s+/gu, " ").trim().replace(/[?？!！。]+$/gu, "");
  const named = text.match(/^(?:その|この|さっきの|先ほどの)(?:Akyo|アキョ|あきょ|アバター)の名前は(.+?)(?:です)?$/iu);
  if (named && isSpecificNameQuery(named[1])) return { kind: "named", name: named[1].trim() };
  if (/^(?:その|この|さっきの|先ほどの)(?:Akyo|アキョ|あきょ|アバター)(?:は|の|が|を|も)/iu.test(text)) {
    return { kind: "needs-context" };
  }
  const count = text.match(/^(.*?)(Akyo|アキョ|あきょ|アバター|ワールド)(?:は|が)?(?:何体|何件|いくつ)(?:ありますか|いますか|ある|いる|ですか)?$/iu);
  const list = text.match(/^(.*?)(Akyo|アキョ|あきょ|アバター|ワールド)を(?:([0-9]{1,3})(?:体|件|つ))?(?:教えて|見せて)(?:ください)?$/iu);
  const match = count ?? list;
  if (!match) return undefined;
  const entryType = match[2] === "ワールド" ? "world" : "avatar";
  let prefix = match[1].trim();
  if (entryType === "world" && /^(?:Akyo|アキョ|あきょ)(?:のいる|がいる|の)$/iu.test(prefix)) prefix = "";
  const authorMatch = prefix.match(/^(.+?)(?:さん)?(?:が作った|作の)$/u);
  const author = authorMatch?.[1].trim();
  const categories: string[] = [];
  if (!author) {
    const modifiers = prefix.replace(/の$/u, "").split(/(?:で|かつ|、)/u).map(s => s.trim());
    for (const modifier of modifiers) {
      if (!modifier && modifiers.length === 1) continue;
      const category = CATEGORY_ALIASES.get(modifier.toLowerCase());
      if (!category) {
        return count ? { kind: "clarification" } : undefined;
      }
      if (!categories.includes(category)) categories.push(category);
    }
  }
  return { kind: count ? "count" : "filtered", categories, author, entryType,
    limit: list?.[3] ? normalizeTopK(Number(list[3])) : undefined };
}

export async function answerCatalogQuestion(
  question: Exclude<Question, { kind: "named" }>, topK: unknown, env: Env,
) {
  if (question.kind === "needs-context" || question.kind === "clarification") {
    return { searchMode: question.kind, results: [], count: 0,
      directAnswer: question.kind === "needs-context"
        ? "どのAkyoについての質問ですか？ 名前を入れて質問してください。"
        : "条件を正確に読み取れませんでした。作者名・対応機種・色など、探したい条件を確認させてください。",
      clarification: question.kind === "needs-context"
        ? "対象のAkyo名を確認してください。別のAkyoを検索して代用しないでください。"
        : "条件を正確に解釈できません。作者名、対応機種、色などの条件を確認してください。" };
  }
  // These Japanese phrases/aliases target the sync-owned JA catalog, not
  // translated category strings. Do not label its records as another language.
  const dataLanguage = "ja";
  const clauses = ["language = ?", question.entryType === "world"
    ? "instr(url, '/world/') > 0" : "instr(url, '/world/') = 0"];
  const values: string[] = [dataLanguage];
  if (question.author) {
    clauses.push("author = ? COLLATE NOCASE");
    values.push(question.author);
  }
  for (const category of question.categories) {
    clauses.push("instr(',' || category || ',', ?) > 0");
    values.push(`,${category},`);
  }
  const where = clauses.join(" AND ");
  const [totalResult, records] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM akyos WHERE ${where}`).bind(...values),
    env.DB.prepare(`SELECT id, nickname, name, category, description, author, url, language
      FROM akyos WHERE ${where} ORDER BY id ASC LIMIT ?`)
      .bind(...values, question.limit ?? normalizeTopK(topK)),
  ]);
  const total = (totalResult.results?.[0] as { total: number } | undefined)?.total ?? 0;
  if (total === 0 && (question.author || question.categories.length)) {
    // An empty intersection is valid only if each condition still exists in D1.
    // Check the whole JA catalog, not just avatars/worlds matching this request.
    const checks = question.categories.map(category => ({
      label: `カテゴリ「${escapeMarkdown(category)}」を現在の図鑑データで確認できませんでした。分類名を確認してください。`,
      statement: env.DB.prepare("SELECT 1 FROM akyos WHERE language = ? AND instr(',' || category || ',', ?) > 0 LIMIT 1")
        .bind(dataLanguage, `,${category},`),
    }));
    if (question.author) checks.push({
      label: `作者名「${escapeMarkdown(question.author)}」は現在の図鑑データで見つかりませんでした。作者名の表記を確認してください。`,
      statement: env.DB.prepare("SELECT 1 FROM akyos WHERE language = ? AND author = ? COLLATE NOCASE LIMIT 1")
        .bind(dataLanguage, question.author),
    });
    const existence = await env.DB.batch(checks.map(check => check.statement));
    const missing = checks.filter((_, index) => !existence[index].results?.length);
    if (missing.length) {
      if (question.kind === "filtered" && !question.author) return undefined;
      const message = missing.map(check => check.label).join("\n");
      return { searchMode: "clarification", results: [], count: 0,
        directAnswer: message, clarification: message };
    }
  }
  const results = ((records.results ?? []) as AkyoRecord[]).map(row => ({ ...row,
    entryType: normalizeEntryType(row.entryType, row.url), score: 1,
    matchType: "exact" as const, matchedField: "filters", matchedKeyword: "" }));
  const conditions = [...question.categories, ...(question.author ? [`作者 ${question.author}`] : [])];
  const heading = conditions.length ? `条件: ${conditions.map(escapeMarkdown).join("、")}\n` : "";
  const noun = question.entryType === "world" ? "ワールド" : "アバター";
  const unit = question.entryType === "world" ? "件" : "体";
  let directAnswer = `${heading}図鑑の該当する${noun}は${total}${unit}です。`;
  if (question.kind === "filtered" && results.length > 0) {
    directAnswer += `うち${results.length}${unit}を紹介します。\n\n` + results.map((row, index) => [
      `${index + 1}. ${escapeMarkdown(row.nickname)}`,
      row.author ? `作者: ${escapeMarkdown(row.author)}` : "",
      row.category ? `分類: ${escapeMarkdown(row.category)}` : "",
      row.url ? `URL: ${/^https?:\/\/[^\s<>]+$/u.test(row.url) ? `<${row.url}>` : escapeMarkdown(row.url)}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
  }
  return { searchMode: question.kind, language: dataLanguage,
    filters: { categories: question.categories, author: question.author, entryType: question.entryType },
    total, results, count: results.length, directAnswer };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>]/gu, "\\$&");
}
