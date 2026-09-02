/**
 * 管理ログイン（POST /api/admin/login）のレート制限。
 *
 * Workers の Rate Limiting binding（wrangler の `ratelimits`）を 2 つ使う。
 *   - IP 単位（遮断）:   ADMIN_LOGIN_IP_LIMITER     名目 10 回 / 60 秒（キー: CF-Connecting-IP）
 *   - 全体（監視専用）: ADMIN_LOGIN_GLOBAL_LIMITER 名目 60 回 / 60 秒（キー固定）
 *
 * 全体段を遮断に使うと、多数の IP からの攻撃が続く間は正当な管理者の新規ログインまで
 * 止まり続ける（各 60 秒窓の予算を攻撃側が消費し続けるため）。管理ログインの可用性を
 * 優先し、全体段は超過を呼び出し側のログに残すだけで遮断しない。
 *
 * カウントは Cloudflare のロケーション単位で eventually consistent、かつ意図的に permissive
 * （公式: 厳密な会計には使えない）。名目値は設定上の目標で、実測では名目の 3〜4 倍まで通る。
 * 総当たりの速度を落とすための層として扱い、判定は次の方針で「通す」側に倒す。
 *   - 無効化フラグ（ADMIN_LOGIN_RATE_LIMIT=off）なら判定しない
 *   - binding が無い環境（ローカル開発・Pages プレビュー）では制限しない
 *   - binding が例外を投げたら制限しない（ログだけ残す）
 *   - 送信元 IP が取れなければ IP 段は飛ばす
 * 遮断された IP は、その IP からの試行が止まれば 60 秒以内に再び受け付けられる。
 */

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AdminLoginRateLimiters {
  ipLimiter?: RateLimiterBinding;
  globalLimiter?: RateLimiterBinding;
}

export type AdminLoginRateLimitResult =
  | { allowed: true; globalBudgetExceeded: boolean }
  | { allowed: false; scope: "ip"; retryAfterSeconds: number };

/** wrangler の `simple.period` と揃える（10 か 60 のみ指定可） */
const RATE_LIMIT_PERIOD_SECONDS = 60;

/** wrangler の vars で staging / production に設定されている値 */
const WORKERS_DEPLOY_TARGET = "workers";

/**
 * 緊急停止スイッチ。環境変数 ADMIN_LOGIN_RATE_LIMIT が "off"（大小・前後空白は無視）
 * のときだけ無効化する。それ以外の値（未設定・空・"on" など）は有効のまま。
 */
export function isAdminLoginRateLimitDisabled(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "off";
}

/**
 * fail-open の痕跡を残すべき環境か。Workers 上（CLOUDFLARE_DEPLOY_TARGET=workers の
 * staging / production）では構成退行で保護が黙って外れないよう警告し、ローカル開発や
 * Pages プレビューでは静かに通す。
 */
export function shouldReportRateLimiterFailure(deployTarget: string | undefined): boolean {
  return (deployTarget ?? "").trim().toLowerCase() === WORKERS_DEPLOY_TARGET;
}

async function consumeToken(
  limiter: RateLimiterBinding,
  key: string,
  scope: "ip" | "global",
): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (error) {
    // binding の障害で管理者を締め出さない（fail-open）。痕跡はログに残す
    console.warn(`[admin-login] rate limiter (${scope}) failed; allowing request`, error);
    return true;
  }
}

export async function checkAdminLoginRateLimit(input: {
  clientIp: string | null | undefined;
  limiters: AdminLoginRateLimiters;
  disabled: boolean;
}): Promise<AdminLoginRateLimitResult> {
  if (input.disabled) {
    return { allowed: true, globalBudgetExceeded: false };
  }

  const { ipLimiter, globalLimiter } = input.limiters;
  const clientIp = input.clientIp?.trim();

  if (ipLimiter && clientIp) {
    const allowed = await consumeToken(ipLimiter, `ip:${clientIp}`, "ip");
    if (!allowed) {
      return { allowed: false, scope: "ip", retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS };
    }
  }

  // 全体段は監視専用: 予算超過を報告するだけで、リクエストは通す
  let globalBudgetExceeded = false;
  if (globalLimiter) {
    globalBudgetExceeded = !(await consumeToken(globalLimiter, "global", "global"));
  }

  return { allowed: true, globalBudgetExceeded };
}

/**
 * Cloudflare コンテキストから binding を取り出す。
 * akyo-data-kv.ts の getKVNamespace と同じく、コンテキストが無い環境では空を返す。
 * Workers 上でコンテキスト取得や binding 参照に失敗した場合は警告を残す。
 */
export async function resolveAdminLoginRateLimiters(
  options: { deployTarget?: string } = {},
): Promise<AdminLoginRateLimiters> {
  const deployTarget = options.deployTarget ?? process.env.CLOUDFLARE_DEPLOY_TARGET;
  const report = shouldReportRateLimiterFailure(deployTarget);

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext();
    const bindings = env as {
      ADMIN_LOGIN_IP_LIMITER?: RateLimiterBinding;
      ADMIN_LOGIN_GLOBAL_LIMITER?: RateLimiterBinding;
    };
    const limiters: AdminLoginRateLimiters = {
      ipLimiter: bindings.ADMIN_LOGIN_IP_LIMITER,
      globalLimiter: bindings.ADMIN_LOGIN_GLOBAL_LIMITER,
    };
    if (report && (!limiters.ipLimiter || !limiters.globalLimiter)) {
      // 設定漏れで保護が黙って外れないよう、Workers ログに残す
      console.warn("[admin-login] rate limiter binding missing; login rate limiting is inactive");
    }
    return limiters;
  } catch (error) {
    if (report) {
      console.warn(
        "[admin-login] Cloudflare context unavailable; login rate limiting is inactive",
        error,
      );
    }
    // ローカル開発・ビルド時・Pages プレビューなど、Cloudflare コンテキストが無い環境
    return {};
  }
}
