import { normalizeTopK } from "./search";
import { normalizeEntryType } from "./types";
import type { AkyoRecord, Env } from "./types";

interface CatalogQuestion {
  kind: "count" | "filtered";
  categories: string[];
  author?: string;
  entryType: "avatar" | "world";
  limit?: number;
}
type Question = CatalogQuestion | { kind: "clarification" } | { kind: "needs-context" };

const CATEGORY_ALIASES = new Map([
  ["quest対応", "対応機種/Quest(Android)"],
  ["android対応", "対応機種/Quest(Android)"],
  ["pc対応", "対応機種/PC"],
  ["ios対応", "対応機種/iOS"],
  ["青色", "色/青色系"], ["青い", "色/青色系"],
  ["赤色", "色/赤色系"], ["赤い", "色/赤色系"],
  ["緑色", "色/緑色系"], ["白色", "色/白色系"],
]);

// Deliberately accept whole, bounded phrases. Unknown/negative/OR modifiers
// must not silently turn into an unfiltered or partially filtered answer.
export function parseCatalogQuestion(query: unknown): Question | undefined {
  if (typeof query !== "string" || query.length > 200) return undefined;
  const text = query.replace(/\s+/gu, " ").trim().replace(/[?？!！。]+$/gu, "");
  if (/^(?:その|この|さっきの|先ほどの)(?:Akyo|アキョ|あきょ|アバター)/iu.test(text)) {
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
        // An unqualified name (e.g. MenmeAkyo) still belongs to name search.
        if (list && !list[3] && !/の$|で|かつ|、|非対応/u.test(prefix)) return undefined;
        return { kind: "clarification" };
      }
      if (!categories.includes(category)) categories.push(category);
    }
  }
  return { kind: count ? "count" : "filtered", categories, author, entryType,
    limit: list?.[3] ? normalizeTopK(Number(list[3])) : undefined };
}

export async function answerCatalogQuestion(
  question: Question, topK: unknown, env: Env,
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
  const results = ((records.results ?? []) as AkyoRecord[]).map(row => ({ ...row,
    entryType: normalizeEntryType(row.entryType, row.url), score: 1,
    matchType: "exact" as const, matchedField: "filters", matchedKeyword: "" }));
  const escape = (value: string) => value.replace(/[\\`*_[\]<>]/gu, "\\$&");
  const conditions = [...question.categories, ...(question.author ? [`作者 ${question.author}`] : [])];
  const heading = conditions.length ? `条件: ${conditions.map(escape).join("、")}\n` : "";
  const noun = question.entryType === "world" ? "ワールド" : "アバター";
  const unit = question.entryType === "world" ? "件" : "体";
  let directAnswer = `${heading}図鑑の該当する${noun}は${total}${unit}です。`;
  if (question.kind === "filtered" && results.length > 0) {
    directAnswer += `うち${results.length}${unit}を紹介します。\n\n` + results.map((row, index) => [
      `${index + 1}. ${escape(row.nickname)}`,
      row.author ? `作者: ${escape(row.author)}` : "",
      row.category ? `分類: ${escape(row.category)}` : "",
      row.url ? `URL: ${/^https?:\/\/[^\s<>]+$/u.test(row.url) ? `<${row.url}>` : escape(row.url)}` : "",
    ].filter(Boolean).join("\n")).join("\n\n");
  }
  return { searchMode: question.kind, language: dataLanguage,
    filters: { categories: question.categories, author: question.author, entryType: question.entryType },
    total, results, count: results.length, directAnswer };
}
