/**
 * akyodex — VRChat の対応プラットフォームを 1 回だけ取得する。
 *
 * 何をするか
 *   data/akyo-data-ja.csv から avtr_ / wrld_ の ID を集め、VRChat API の
 *   unityPackages[].platform を読んで platforms.json に書き出す。
 *   standalonewindows / android / ios のどれを持つかが分かる。
 *
 * VRChat の Creator Guidelines に合わせている点
 *   https://hello.vrchat.com/creator-guidelines
 *   - User-Agent で名乗る（applicationName/Version contactInfo）
 *   - 固定間隔で叩かない（毎回ジッターを入れる）
 *   - エラー時はバックオフする（429 / 5xx で指数バックオフ）
 *   - キャッシュする（結果を書き出し、再実行時は取得済みを飛ばす）
 *   - 他人の代理で動かない（本人のアカウントで、本人の PC から、1 回だけ）
 *
 * 認証
 *   VRCHAT_AUTH_COOKIE に auth クッキーの値を入れて実行する。
 *   このスクリプトは値を表示も保存もしない。出力にも含めない。
 *   取り方: vrchat.com にログイン → DevTools → Application → Cookies →
 *   vrchat.com の `auth` の値。
 *
 * 使い方（PowerShell）
 *   $env:VRCHAT_AUTH_COOKIE = "<auth クッキーの値>"
 *   node fetch-platforms.mjs E:\akyodex\data\akyo-data-ja.csv .\platforms.json
 *
 *   途中で止めても、同じコマンドで続きから再開する。
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { realPlatformsOf } from "./record.mjs";

const USER_AGENT = "akyodex-platform-backfill/1.0 (+https://akyodex.com)";
const BASE = "https://api.vrchat.cloud/api/1";
const MIN_GAP_MS = 1200;
const JITTER_MS = 800;
const MAX_RETRY = 5;

/**
 * 実行時だけ検査する。テストから import したときに終了させないため。
 * @returns {object|null} main() に渡す設定。不足があれば null
 */
function parseArgs(argv, env) {
  const [csvPath, outPath = "platforms.json"] = argv.filter((a) => !a.startsWith("--"));
  const cookie = env.VRCHAT_AUTH_COOKIE;

  if (!csvPath) {
    console.error("使い方: node fetch-platforms.mjs <akyo-data-ja.csv> [出力先.json] [--refresh]");
    console.error("  --refresh  取得済みの記録も取り直す（作者が後から Quest 版を上げた分を拾う）");
    return null;
  }
  if (!cookie) {
    console.error("VRCHAT_AUTH_COOKIE が設定されていません。");
    console.error('PowerShell: $env:VRCHAT_AUTH_COOKIE = "<auth クッキーの値>"');
    return null;
  }
  return { csvPath, outPath, cookie, refresh: argv.includes("--refresh") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitteredGap = () => MIN_GAP_MS + Math.random() * JITTER_MS;

/** CSV から VRChat の ID を集める。順序は安定させる（再開時に同じ並びになるよう）。 */
async function collectIds(path) {
  const csv = await readFile(path, "utf8");
  const seen = new Map();
  for (const [id] of csv.matchAll(/\b(avtr|wrld)_[0-9a-fA-F-]{36}\b/g)) {
    if (!seen.has(id)) seen.set(id, id.startsWith("avtr_") ? "avatar" : "world");
  }
  return [...seen].map(([id, kind]) => ({ id, kind }));
}

/**
 * 取得しにいく対象を選ぶ。
 *
 * 既定は中断からの再開なので、成功済みは飛ばす。ただし対応機種は後から増える
 * （作者が Quest 版を上げる）ので、それを取り込むには --refresh で全件を
 * 取り直す必要がある。schema が無い記録は impostor 除外前の古い形式なので、
 * --refresh の有無にかかわらず取り直す。
 *
 * 200 なのに実ビルドが空の記録も同じ扱いにする。取得はできているが判定は
 * できていない状態で、成功として確定させると二度と取り直さなくなる。
 */
export function selectTargets(targets, results, { refresh = false } = {}) {
  return targets.filter((t) => {
    const previous = results[t.id];
    if (!previous) return true;
    if (previous.status === 0) return true;       // 通信に失敗した記録
    if (previous.schema !== 2) return true;       // 古い形式
    if (previous.status === 200 && realPlatformsOf(previous) === null) return true; // 200 だが空
    return refresh;
  });
}

/**
 * 今回の取得結果を受けて、ファイルに保存する記録を決める。
 *
 * 根拠のある値を根拠のない結果で消さないのと同時に、**今回判定できなかった事実も
 * 必ず記録に残す**のが役目。値だけ残して事実を落とすと、次に付与スクリプトが古い
 * 成功キャッシュを最新の判定として使い、あいだに手入力で足された対応機種タグを
 * 消してしまう。しかも再開時は成功済みとして飛ばされ、取り直されない。
 *
 * @param {object|undefined} previous 既存の記録
 * @param {{status: number, platforms?: string[]}} result 今回の取得結果
 * @param {"avatar"|"world"} kind
 * @returns {{record: object, reason: string|null}} record が保存するもの。reason は上書きしなかった理由
 */
export function resolveRecord(previous, result, kind) {
  const gotBuild = realPlatformsOf(result) !== null;

  // オーナー申告（source: manual）は API の結果で上書きも無効化もしない。
  // API では取れないと分かっているものを手で入れた記録なので、失敗は想定内。
  if (!gotBuild && previous?.source?.startsWith("manual")) {
    const what = result.status === 200 ? "200 だが実ビルドが空" : String(result.status);
    return { record: previous, reason: `${what} だったが手入力の記録がある` };
  }

  // 200 でも実ビルドが空なら「対応終了」ではなく判定できていない。クッキーが
  // 切れると 401 ではなく 200 ＋ 空で返ってくるため。前の値は残しつつ、
  // 判定できなかったことを unjudged に書き残す。
  if (result.status === 200 && !gotBuild) {
    const reason = "200 だが実ビルドが空だった";
    return { record: { ...(previous ?? { kind, ...result }), unjudged: reason }, reason };
  }

  // 取り直せた場合と、404 のように API が明確に答えた場合。丸ごと差し替えるので、
  // 前回付いていた unjudged はここで消える。
  return { record: { kind, ...result }, reason: null };
}

/** 1 件取得する。429 / 5xx は指数バックオフで粘り、それ以外は結果を返す。 */
async function fetchOne(id, kind, cookie) {
  const url = `${BASE}/${kind === "avatar" ? "avatars" : "worlds"}/${encodeURIComponent(id)}`;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          Cookie: `auth=${cookie}`,
        },
      });
    } catch (error) {
      if (attempt === MAX_RETRY) return { status: 0, error: String(error.message || error) };
      await sleep(2000 * 2 ** attempt + Math.random() * 1000);
      continue;
    }

    if (response.status === 401) {
      // クッキーが無効か期限切れ。粘っても意味がないので即座に止める。
      throw new Error("401 Unauthorized — auth クッキーが無効か期限切れです。取り直してください。");
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRY) return { status: response.status };
      const wait = 2000 * 2 ** attempt + Math.random() * 1000;
      console.warn(`  ${response.status} — ${Math.round(wait / 1000)} 秒待って再試行 (${attempt + 1}/${MAX_RETRY})`);
      await sleep(wait);
      continue;
    }

    if (!response.ok) return { status: response.status };

    const body = await response.json();
    const packages = body.unityPackages ?? [];

    // impostor は VRChat が自動生成する代替モデルで、作者がその機種向けに
    // ビルドしたわけではない。PC のみのアバターにも Quest / iOS 用が勝手に
    // 作られるので、これを数えると全件が「対応」に見える。
    // 実データでは variant === "impostor" と impostorizerVersion が同時に入る。
    // https://creators.vrchat.com/avatars/avatar-impostors/
    const isImpostor = (p) => p.variant === "impostor" || p.impostorizerVersion != null;
    const uniq = (list) => [...new Set(list.filter(Boolean))].sort();

    return {
      schema: 2,
      status: 200,
      name: body.name ?? "",
      releaseStatus: body.releaseStatus ?? "",
      // 作者が実際に上げたビルド。これが対応機種の根拠になる。
      platforms: uniq(packages.filter((p) => !isImpostor(p)).map((p) => p.platform)),
      // 自動生成分。判定には使わないが、差を見られるように残す。
      impostorPlatforms: uniq(packages.filter(isImpostor).map((p) => p.platform)),
      variants: uniq(packages.map((p) => p.variant)),
      packageCount: packages.length,
    };
  }
  return { status: 0, error: "retry exhausted" };
}


/**
 * 開始前の検査。
 *
 * クッキーが無効でも、ワールドは 200 で unityPackages を空にして返してくる。
 * そのまま走らせると 948 件を取り切ったうえで「全件プラットフォーム不明」に
 * なり、失敗に見えない。アバターは無効なら 401 を返すので、そちらで確かめる。
 */
async function preflight(targets, fetchOne) {
  const probe = targets.find((t) => t.kind === "avatar");
  if (!probe) return;
  const result = await fetchOne(probe.id, probe.kind); // 401 なら fetchOne が投げる
  if (result.status === 200 && (result.platforms?.length ?? 0) === 0) {
    throw new Error(
      `検査に失敗: ${probe.id} が 200 なのに unityPackages が空です。` +
        "クッキーは通っているが権限が足りない可能性があります。",
    );
  }
  if (result.status !== 200) {
    console.warn(`検査したアバターが ${result.status} でした（非公開か削除済みかもしれません）。続行します。`);
    return;
  }
  console.log(`検査 OK: ${probe.id} → ${result.platforms.join("+")}\n`);
}

/**
 * 本体。process.exit() を使わず、例外は下の catch で受けて終了コードだけ立てる。
 * exit() で即座に落とすと、生きているソケットと競合して Windows の Node が
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" を吐き、壊れたように見える。
 */
export async function main({
  csvPath,
  outPath = "platforms.json",
  cookie,
  refresh = false,
  // テストから差し替えられるようにしてある。既定は実 API を叩く。
  fetcher = (id, kind) => fetchOne(id, kind, cookie),
  gap = jitteredGap,
} = {}) {
  const fetch1 = fetcher;
  const targets = await collectIds(csvPath);
  await preflight(targets, fetch1);

  const results = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
  const todo = selectTargets(targets, results, { refresh });

  console.log(`対象 ${targets.length} 件（アバター ${targets.filter((t) => t.kind === "avatar").length} / ワールド ${targets.filter((t) => t.kind === "world").length}）`);
  console.log(`${refresh ? "--refresh: 全件を取り直します。" : ""}取得済みで飛ばす ${targets.length - todo.length} 件、これから ${todo.length} 件`);
  console.log(`想定所要 約 ${Math.ceil((todo.length * (MIN_GAP_MS + JITTER_MS / 2)) / 60000)} 分\n`);

  let done = 0;
  const emptyRun = []; // 200 で返ってきたが実ビルドが空だったもの
  for (const { id, kind } of todo) {
    let result;
    try {
      result = await fetch1(id, kind);
    } catch (error) {
      // 途中でクッキーが失効した場合。ここまでの結果は残してから投げる。
      await writeFile(outPath, JSON.stringify(results, null, 1), "utf8");
      console.error(`ここまでの ${done} 件は ${outPath} に保存しました。`);
      throw error;
    }
    if (result.status === 200 && realPlatformsOf(result) === null) emptyRun.push(id);

    const { record, reason } = resolveRecord(results[id], result, kind);
    if (reason) console.warn(`  ${id} は ${reason}ため、前の記録を残します`);
    results[id] = record;
    done += 1;

    if (done % 10 === 0 || done === todo.length) {
      await writeFile(outPath, JSON.stringify(results, null, 1), "utf8");
      const pct = ((done / todo.length) * 100).toFixed(1);
      console.log(`  ${done}/${todo.length} (${pct}%) 最新: ${id} → ${result.status} ${result.platforms?.join("+") ?? ""}`);
    }

    if (done < todo.length) await sleep(gap());
  }

  await writeFile(outPath, JSON.stringify(results, null, 1), "utf8");

  // 集計。実ビルドと、impostor を混ぜた場合の両方を出して差を見る。
  const count = (kind, pred) => {
    let n = 0;
    for (const r of Object.values(results)) {
      if (r.status !== 200) continue;
      if (kind !== "all" && r.kind !== kind) continue;
      if (pred(r)) n += 1;
    }
    return n;
  };
  const hasReal = (platform) => (r) => (r.platforms ?? []).includes(platform);
  const hasEither = (platform) => (r) =>
    (r.platforms ?? []).includes(platform) || (r.impostorPlatforms ?? []).includes(platform);

  const okCount = count("all", () => true);
  const failed = Object.values(results).filter((r) => r.status !== 200).length;

  const row = (label, platform) =>
    `  ${label.padEnd(24)} 実ビルド ${String(count("all", hasReal(platform))).padStart(4)}` +
    `  （アバター ${String(count("avatar", hasReal(platform))).padStart(3)}` +
    ` / ワールド ${String(count("world", hasReal(platform))).padStart(3)}）` +
    `   impostor 込み ${String(count("all", hasEither(platform))).padStart(4)}`;

  console.log(`\n=== 集計（取得できた ${okCount} 件 / 全 ${Object.keys(results).length} 件） ===`);
  console.log(row("PC (standalonewindows)", "standalonewindows"));
  console.log(row("Quest (android)", "android"));
  console.log(row("iOS", "ios"));
  console.log(`  ${"PC を持たない".padEnd(24)} ${count("all", (r) => !(r.platforms ?? []).includes("standalonewindows"))}`);
  console.log(`  ${"実ビルドが 0 件".padEnd(24)} ${count("all", (r) => (r.platforms ?? []).length === 0)}`);
  console.log(`  ${"取得できず (401以外)".padEnd(24)} ${failed}`);
  console.log(`\n  variant の実測値: ${[...new Set(Object.values(results).flatMap((r) => r.variants ?? []))].sort().join(", ")}`);
  console.log(`\n出力: ${outPath}`);

  if (emptyRun.length) {
    console.warn(
      `\n注意: ${emptyRun.length} 件が HTTP 200 なのに実ビルドが空でした。` +
        "途中でクッキーが切れた可能性があります。\n" +
        "これらは判定できなかった扱いなので、付与スクリプトはカテゴリを変えません。次回の実行で取り直します。",
    );
  }
}

// テストから import したときは実行しない
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

try {
  if (isDirectRun) {
    const options = parseArgs(process.argv.slice(2), process.env);
    if (!options) process.exitCode = 2;
    else await main(options);
  }
} catch (error) {
  console.error(`
中断: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
