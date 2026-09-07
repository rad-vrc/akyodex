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
  /**
   * 大文字小文字や Unicode 正規化だけが違う既存カテゴリ。完全一致しないので作れて
   * しまうが、並ぶと見分けが付かないので画面はこれを見て作成を止める
   */
  similarTo: string[];
}

/** 表記ゆれの検出用。作成の可否には使わない（サーバーは完全一致で判定する） */
function fold(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/**
 * `path` を上の階層から順に分解し、それぞれが既存かどうかを付ける。
 * 空の入力や空の階層があれば空配列を返す（入力途中なので何も訊かない）。
 *
 * 既存かどうかはサーバーの `categoryExists` と同じ完全一致で判定する。表記ゆれを
 * 吸収して「既存」と見なすと、サーバーが対訳を要求する階層の入力欄を画面が出さず、
 * 画面上に満たす手段が無いエラーになる。表記ゆれは `similarTo` として別に返し、
 * 作成を止めるかどうかは画面が決める。
 */
export function planCategoryCreateLevels(
  path: string,
  existing: Iterable<string>,
): CategoryCreateLevel[] {
  const trimmed = path.trim();
  if (trimmed === '') return [];
  const segments = trimmed.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment === '')) return [];

  const known = [...existing];
  const exact = new Set(known);
  return segments.map((segment, index) => {
    const levelPath = segments.slice(0, index + 1).join('/');
    if (exact.has(levelPath)) return { path: levelPath, segment, exists: true, similarTo: [] };
    const folded = fold(levelPath);
    // 一致するものは全部返す。1 つだけ選ぶと、どれが選ばれたかが並び順任せになる
    const similarTo = known.filter((entry) => fold(entry) === folded);
    return { path: levelPath, segment, exists: false, similarTo };
  });
}

/**
 * 作成を止めるべき階層。見分けの付かないカテゴリが増えるのを防ぐ。
 * 完全一致の既存は `exists` で入力欄が出ないので、ここには出てこない。
 */
export function findLookAlikeLevel(
  levels: CategoryCreateLevel[],
): CategoryCreateLevel | undefined {
  return levels.find((level) => !level.exists && level.similarTo.length > 0);
}

/** 画面に出す文言。どの階層が、どの既存と紛らわしいのかを名指しする */
export function lookAlikeMessage(level: CategoryCreateLevel): string {
  return `「${level.path}」は既存の「${level.similarTo.join('」「')}」と大文字小文字や表記だけが違います。並ぶと見分けが付かないので、別の名前にしてください`;
}
