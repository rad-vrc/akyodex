import type { AkyoRecord, CountResult, Env, Language } from "./types";

export async function countByKeyword(
  keyword: string,
  language: Language,
  env: Env
): Promise<CountResult> {
  const like = `%${keyword}%`;
  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM akyos
    WHERE language = ? AND (
      category LIKE ? OR author LIKE ? OR nickname LIKE ? OR name LIKE ?
    )
  `)
    .bind(language, like, like, like, like)
    .first<{ total: number }>();

  const examplesResult = await env.DB.prepare(`
    SELECT id, nickname, category, author
    FROM akyos
    WHERE language = ? AND (
      category LIKE ? OR author LIKE ? OR nickname LIKE ? OR name LIKE ?
    )
    ORDER BY id ASC
    LIMIT 10
  `)
    .bind(language, like, like, like, like)
    .all<Pick<AkyoRecord, "id" | "nickname" | "category" | "author">>();

  return {
    count: countResult?.total ?? 0,
    examples: examplesResult.results ?? [],
  };
}

export async function countByAuthor(author: string, env: Env): Promise<CountResult> {
  const result = await env.DB.prepare(`
    SELECT id, nickname, category, language
    FROM akyos
    WHERE author = ?
    ORDER BY id ASC
  `)
    .bind(author)
    .all<Pick<AkyoRecord, "id" | "nickname" | "category" | "language">>();

  return {
    count: result.results?.length ?? 0,
    avatars: result.results ?? [],
  };
}
