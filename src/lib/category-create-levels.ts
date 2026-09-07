/**
 * 新規作成フォームが「どの階層の対訳を訊くべきか」を決める部分。
 *
 * カテゴリの対訳は全階層に必要で、子の名前は親の名前を前に付けて作る。そのため
 * 「新しい親/新しい子」をまとめて作るには、足りない階層ごとに英語名・韓国語名が要る。
 * 画面はここが返した階層をそのまま並べればよく、「この階層」がどこを指すのかを
 * 利用者に推測させずに済む。
 */

export interface CategoryCreateLevel {
  /** 完全なパス（例: `色/赤色系`） */
  path: string;
  /** この階層の名前だけ（例: `赤色系`） */
  segment: string;
  /** 既に存在するか。存在するなら対訳は既にあるので入力欄を出さない */
  exists: boolean;
}

/**
 * `path` を上の階層から順に分解し、それぞれが既存かどうかを付ける。
 * 空の入力や空の階層があれば空配列を返す（入力途中なので何も訊かない）。
 *
 * 既存かどうかはサーバーの `categoryExists` と同じ完全一致で判定する。表記ゆれを
 * 吸収して「既存」と見なすと、サーバーが対訳を要求する階層の入力欄を画面が出さず、
 * 画面上に満たす手段が無いエラーになる。
 */
export function planCategoryCreateLevels(
  path: string,
  existing: Iterable<string>,
): CategoryCreateLevel[] {
  const trimmed = path.trim();
  if (trimmed === '') return [];
  const segments = trimmed.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment === '')) return [];

  const known = new Set(existing);
  return segments.map((segment, index) => {
    const levelPath = segments.slice(0, index + 1).join('/');
    return { path: levelPath, segment, exists: known.has(levelPath) };
  });
}
