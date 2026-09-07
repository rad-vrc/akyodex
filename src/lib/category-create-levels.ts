/**
 * 新規作成フォームが「どの階層の対訳を訊くべきか」を決める部分。
 *
 * カテゴリの対訳は全階層に必要で、子の名前は親の名前を前に付けて作る。そのため
 * 「新しい親/新しい子」をまとめて作るには、足りない階層ごとに英語名・韓国語名が要る。
 * 画面はここが返した階層をそのまま並べればよく、「この階層」がどこを指すのかを
 * 利用者に推測させずに済む。
 */

import { foldCategoryName, lookAlikeCategoryMessage } from './category-operations';

export interface CategoryCreateLevel {
  /** 完全なパス（例: `色/赤色系`） */
  path: string;
  /** この階層の名前だけ（例: `赤色系`） */
  segment: string;
  /** 既に存在するか。存在するなら対訳は既にあるので入力欄を出さない */
  exists: boolean;
  /**
   * 大文字小文字や Unicode 正規化だけが違う既存カテゴリ。完全一致しないので作れて
   * しまうが、並ぶと見分けが付かないのでサーバーが拒否する（`requireNoLookAlike`）。
   * 画面は送る前にこれを見て、同じ理由で止める
   */
  similarTo: string[];
}

/**
 * `path` を上の階層から順に分解し、それぞれが既存かどうかを付ける。
 * 空の入力や空の階層があれば空配列を返す（入力途中なので何も訊かない）。
 *
 * 既存かどうかはサーバーの `categoryExists` と同じ完全一致で判定する。表記ゆれを
 * 吸収して「既存」と見なすと、サーバーが対訳を要求する階層の入力欄を画面が出さず、
 * 画面上に満たす手段が無いエラーになる。表記ゆれは `similarTo` として別に返す。
 */
export function planCategoryCreateLevels(
  path: string,
  existing: Iterable<string>,
): CategoryCreateLevel[] {
  const trimmed = path.trim();
  if (trimmed === '') return [];
  const segments = trimmed.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment === '')) return [];

  const exact = new Set<string>();
  // 畳み込みは既存 1 件につき 1 回。階層ごとに全件を畳み直すと打鍵のたびに効いてくる
  const folded = new Map<string, string[]>();
  for (const entry of existing) {
    exact.add(entry);
    const key = foldCategoryName(entry);
    const bucket = folded.get(key);
    if (bucket) bucket.push(entry);
    else folded.set(key, [entry]);
  }

  return segments.map((segment, index) => {
    const levelPath = segments.slice(0, index + 1).join('/');
    if (exact.has(levelPath)) return { path: levelPath, segment, exists: true, similarTo: [] };
    // 一致するものは全部返す。1 つだけ選ぶと、どれが選ばれたかが並び順任せになる
    return {
      path: levelPath,
      segment,
      exists: false,
      // 索引の配列をそのまま渡すと、呼び出し側の並べ替えで索引が壊れる
      similarTo: [...(folded.get(foldCategoryName(levelPath)) ?? [])],
    };
  });
}

/**
 * 作成を止める理由。無ければ `undefined`。
 *
 * 完全一致の既存（末尾）と表記ゆれは、利用者にとっては「その名前は使えない」という
 * 1 つの話なので、判定も文言もここにまとめる。サーバーも同じ規則で拒否するので、
 * ここは送る前に気付かせるためのもの
 */
export function findCreateBlocker(levels: CategoryCreateLevel[]): string | undefined {
  const leaf = levels.at(-1);
  if (leaf?.exists) return 'このカテゴリは既に存在します';

  // 1 件ずつ返すと、直しては送り直しを繰り返させることになる
  const lookAlikes = levels.filter((level) => !level.exists && level.similarTo.length > 0);
  if (lookAlikes.length === 0) return undefined;
  // 文言はサーバーと同じものを使う。片方だけ直して食い違わないように
  return lookAlikeCategoryMessage(lookAlikes);
}

/**
 * 画面がその場で作ったカテゴリを候補一覧に足す。表記ゆれで二重に並べない。
 * 編集モーダルと新規登録タブが同じ扱いをするので、規則はここに 1 つだけ置く
 */
export function addCategoryOption(options: string[], name: string): string[] {
  const folded = foldCategoryName(name);
  if (!folded) return options;
  if (options.some((existing) => foldCategoryName(existing) === folded)) return options;
  return [...options, name.trim()];
}
