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

const [csvPath, outPath = "platforms.json"] = process.argv.slice(2);
const cookie = process.env.VRCHAT_AUTH_COOKIE;

const USER_AGENT = "akyodex-platform-backfill/1.0 (+https://akyodex.com)";
const BASE = "https://api.vrchat.cloud/api/1";
const MIN_GAP_MS = 1200;
const JITTER_MS = 800;
const MAX_RETRY = 5;

if (!csvPath) {
  console.error("使い方: node fetch-platforms.mjs <akyo-data-ja.csv> [出力先.json]");
  process.exit(2);
}
if (!cookie) {
  console.error("VRCHAT_AUTH_COOKIE が設定されていません。");
  console.error('PowerShell: $env:VRCHAT_AUTH_COOKIE = "<auth クッキーの値>"');
  process.exit(2);
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

/** 1 件取得する。429 / 5xx は指数バックオフで粘り、それ以外は結果を返す。 */
async function fetchOne(id, kind) {
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

const targets = await collectIds(csvPath);

/**
 * 開始前の検査。
 *
 * クッキーが無効でも、ワールドは 200 で unityPackages を空にして返してくる。
 * そのまま走らせると 948 件を取り切ったうえで「全件プラットフォーム不明」に
 * なり、失敗に見えない。アバターは無効なら 401 を返すので、そちらで確かめる。
 */
async function preflight() {
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
async function main() {
  await preflight();

  const results = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
// schema が無い記録は impostor を除外する前の古い形式なので取り直す。
  const todo = targets.filter(
    (t) => !results[t.id] || results[t.id].status === 0 || results[t.id].schema !== 2,
  );

  console.log(`対象 ${targets.length} 件（アバター ${targets.filter((t) => t.kind === "avatar").length} / ワールド ${targets.filter((t) => t.kind === "world").length}）`);
  console.log(`取得済み ${targets.length - todo.length} 件、これから ${todo.length} 件`);
  console.log(`想定所要 約 ${Math.ceil((todo.length * (MIN_GAP_MS + JITTER_MS / 2)) / 60000)} 分\n`);

  let done = 0;
  for (const { id, kind } of todo) {
    let result;
    try {
      result = await fetchOne(id, kind);
    } catch (error) {
      // 途中でクッキーが失効した場合。ここまでの結果は残してから投げる。
      await writeFile(outPath, JSON.stringify(results, null, 1), "utf8");
      console.error(`ここまでの ${done} 件は ${outPath} に保存しました。`);
      throw error;
    }
    results[id] = { kind, ...result };
    done += 1;

    if (done % 10 === 0 || done === todo.length) {
      await writeFile(outPath, JSON.stringify(results, null, 1), "utf8");
      const pct = ((done / todo.length) * 100).toFixed(1);
      console.log(`  ${done}/${todo.length} (${pct}%) 最新: ${id} → ${result.status} ${result.platforms?.join("+") ?? ""}`);
    }

    if (done < todo.length) await sleep(jitteredGap());
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
}

try {
  await main();
} catch (error) {
  console.error(`
中断: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
