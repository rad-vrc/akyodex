import type { AkyoRecord, CountResult, Env, Language } from "./types";
import { escapeLikePattern } from "./search";

const KEYWORD_MATCH_SQL = `
  category LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR
  nickname LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
`;

export async function countByKeyword(
  keyword: string,
  language: Language,
  env: Env
): Promise<CountResult> {
  const like = `%${escapeLikePattern(keyword)}%`;
  const [countResult, examplesResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM akyos
      WHERE language = ? AND (${KEYWORD_MATCH_SQL})
    `).bind(language, like, like, like, like),
    env.DB.prepare(`
      SELECT id, nickname, category, author
      FROM akyos
      WHERE language = ? AND (${KEYWORD_MATCH_SQL})
      ORDER BY id ASC
      LIMIT 10
    `).bind(language, like, like, like, like),
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
