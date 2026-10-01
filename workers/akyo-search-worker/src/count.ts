import type { AkyoRecord, CountResult, Env, Language } from "./types";
import { createSubstringMatch } from "./sql-matching";

export async function countByKeyword(
  keyword: string,
  language: Language,
  env: Env
): Promise<CountResult> {
  const { sql: contains, parameter } = createSubstringMatch(keyword);
  const keywordMatchSql = `
    ${contains("category")} OR ${contains("author")} OR
    ${contains("nickname")} OR ${contains("name")}
  `;
  const [countResult, examplesResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM akyos
      WHERE language = ? AND (${keywordMatchSql})
    `).bind(language, parameter, parameter, parameter, parameter),
    env.DB.prepare(`
      SELECT id, nickname, category, author
      FROM akyos
      WHERE language = ? AND (${keywordMatchSql})
      ORDER BY id ASC
      LIMIT 10
    `).bind(language, parameter, parameter, parameter, parameter),
  ]);
  const countRow = countResult.results?.[0] as { total?: number } | undefined;
  const examples = (examplesResult.results ?? []) as Array<
    Pick<AkyoRecord, "id" | "nickname" | "category" | "author">
  >;

  return {
    count: countRow?.total ?? 0,
    examples,
  };
}

export async function countByAuthor(author: string, env: Env): Promise<CountResult> {
  const [countResult, avatarsResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM akyos
      WHERE author = ?
    `).bind(author),
    env.DB.prepare(`
      SELECT id, nickname, category, language
      FROM akyos
      WHERE author = ?
      ORDER BY id ASC
      LIMIT 10
    `).bind(author),
  ]);
  const countRow = countResult.results?.[0] as { total?: number } | undefined;
  const avatars = (avatarsResult.results ?? []) as Array<
    Pick<AkyoRecord, "id" | "nickname" | "category" | "language">
  >;

  return {
    count: countRow?.total ?? 0,
    avatars,
  };
}
