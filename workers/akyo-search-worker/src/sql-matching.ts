const MAX_D1_LIKE_PATTERN_BYTES = 50;
const encoder = new TextEncoder();

type SearchColumn = "nickname" | "name" | "category" | "description" | "author";

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export function createSubstringMatch(keyword: string) {
  const pattern = `%${escapeLikePattern(keyword)}%`;
  // D1 counts UTF-8 bytes, including escapes and the surrounding wildcards.
  const useLike = encoder.encode(pattern).byteLength <= MAX_D1_LIKE_PATTERN_BYTES;

  return {
    parameter: useLike ? pattern : keyword,
    sql(column: SearchColumn): string {
      // SQL lower(), like default LIKE, folds ASCII only. Bind the full literal.
      return useLike
        ? `${column} LIKE ? ESCAPE '\\'`
        : `instr(lower(${column}), lower(?)) > 0`;
    },
  };
}
