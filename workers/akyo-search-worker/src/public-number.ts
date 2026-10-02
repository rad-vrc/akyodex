import { cleanNaturalLanguageQuery } from "./search";
import { normalizeEntryType } from "./types";
import type { AkyoRecord, EntryType, Env, Language, SearchResult } from "./types";

interface PublicNumber {
  serial: string;
  entryType?: EntryType;
}

export class PublicCatalogNotReadyError extends Error {
  constructor() { super("Public numbers require a completed catalog sync; please retry later."); }
}

export function parsePublicNumber(value: unknown): PublicNumber | undefined {
  if (typeof value !== "string" || value.length > 200) return;
  const text = cleanNaturalLanguageQuery(value.normalize("NFKC"))
    .replace(/の作者(?:は誰(?:ですか)?)?$/u, "").trim();
  const prefixed = text.match(/^#?(avatar|world|アバター|ワールド)(\d{1,4})(?:\s*の\s*(?:akyo|アキョ|あきょ|アバター|ワールド))?$/iu);
  if (prefixed) return { serial: prefixed[2].padStart(4, "0"),
    entryType: /^(world|ワールド)$/iu.test(prefixed[1]) ? "world" : "avatar" };
  const numbered = text.match(/^(#)?\s*(\d{1,4})(番)?(?:\s*の\s*(akyo|アキョ|あきょ|アバター|ワールド))?$/iu);
  if (!numbered) return;
  // Without # or 番, "2025のアバター" can refer to a year, not a number.
  if (numbered[4] && !numbered[1] && !numbered[3]) return;
  return { serial: numbered[2].padStart(4, "0"), entryType: numbered[4]
    ? numbered[4] === "ワールド" ? "world" : "avatar" : undefined };
}

export async function answerPublicNumber(number: PublicNumber, language: Language, env: Env) {
  const columns = await env.DB.prepare("PRAGMA table_info(akyos)").all<{ name: string }>();
  if (!columns.results?.some(column => column.name === "publicId")) throw new PublicCatalogNotReadyError();
  // A partial migration must not turn an ambiguous bare number into a unique hit.
  const incomplete = await env.DB.prepare("SELECT id FROM akyos WHERE publicId IS NULL OR publicId = '' LIMIT 1").first();
  if (incomplete) throw new PublicCatalogNotReadyError();
  const publicIds = number.entryType
    ? [`${number.entryType === "world" ? "World" : "Avatar"}${number.serial}`]
    : [`Avatar${number.serial}`, `World${number.serial}`];
  const response = await env.DB.prepare(`SELECT id, nickname, name, category, description, author, url, language, publicId
    FROM akyos WHERE publicId IN (${publicIds.map(() => "?").join(", ")})
      AND language IN (?, 'ja')
    ORDER BY CASE WHEN language = ? THEN 0 ELSE 1 END, id ASC`)
    .bind(...publicIds, language, language).all<AkyoRecord & { publicId: string }>();
  const byPublicId = new Map<string, AkyoRecord & { publicId: string }>();
  for (const row of response.results ?? []) {
    const expectedType = row.publicId.startsWith("World") ? "world" : "avatar";
    if (normalizeEntryType(row.entryType, row.url) !== expectedType) throw new PublicCatalogNotReadyError();
    const previous = byPublicId.get(row.publicId);
    if (previous?.language === row.language) throw new PublicCatalogNotReadyError();
    if (!previous) byPublicId.set(row.publicId, row);
  }
  if (byPublicId.size > 1) {
    const choices = [...byPublicId.keys()].map(id => `#${id}`).join(" / ");
    const directAnswer = language === "ja" ? `この番号はアバターとワールドの両方にあります。${choices} のどちらか、番号を含めてもう一度送ってください。`
      : language === "ko" ? `이 번호는 아바타와 월드에 모두 있습니다. ${choices} 중 하나를 번호까지 포함하여 다시 보내 주세요.`
        : `This number exists for both an avatar and a world. Please send one of ${choices} again, including the full number.`;
    return { language, searchMode: "clarification", directAnswer, results: [], count: 0 };
  }
  const results: SearchResult[] = [...byPublicId.values()].map(row => ({ ...row,
    entryType: normalizeEntryType(row.entryType, row.url), score: 1, matchType: "exact",
    matchedField: "publicId", matchedKeyword: row.publicId }));
  return { language, searchMode: "specific-name", nameMatch: results.length > 0, results, count: results.length };
}
