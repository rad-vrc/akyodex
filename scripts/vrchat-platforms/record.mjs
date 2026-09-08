/**
 * platforms.json の 1 レコードの読み方。取得側と付与側で同じ判断をするために、
 * ここ 1 か所に置いてある。
 */

/**
 * 対応機種の根拠になる「作者が実際に上げたビルド」を取り出す。
 * 判定できなければ null を返す。
 *
 * HTTP 200 でも実ビルドが空で返ることがある。クッキーが無効なとき、ワールドは
 * 401 ではなく 200 ＋ 空の unityPackages を返すため（fetch-platforms.mjs の
 * preflight 参照）。開始前の検査はアバター 1 件のその瞬間しか保証しないので、
 * 途中でクッキーが切れれば、以降のワールドは黙って空になる。
 *
 * 空を「その機種には対応していない」と読み替えると、確認できていないのに既存の
 * Quest / iOS タグを消してしまう。取得できなかったことと、対応していないことは
 * 別に扱う。
 *
 * unjudged が付いた記録も判定できなかったものとして扱う。直近の取得が空だった
 * ため、古い成功キャッシュの値をそのまま残してある状態を指す。値は残っている
 * が最新の判定ではないので、これを最新として使うと、あいだに手入力で足された
 * 対応機種タグを消してしまう。取り直しに成功した時点で unjudged ごと差し替わる。
 *
 * @param {{status?: number, platforms?: string[], unjudged?: string}|null|undefined} record
 * @returns {string[]|null}
 */
export function realPlatformsOf(record) {
  if (!record || record.status !== 200) return null;
  if (record.unjudged) return null;
  const platforms = record.platforms ?? [];
  return platforms.length ? platforms : null;
}
