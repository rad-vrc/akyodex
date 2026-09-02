/**
 * 管理ログイン（POST /api/admin/login）のレート制限。
 *
 * Workers の Rate Limiting binding（wrangler の `ratelimits`）を 2 段で使う。
 *   - IP 単位:  ADMIN_LOGIN_IP_LIMITER     10 回 / 60 秒（キー: CF-Connecting-IP）
 *   - 全体:     ADMIN_LOGIN_GLOBAL_LIMITER 60 回 / 60 秒（キー固定）
 *
 * カウントは Cloudflare のロケーション単位で eventually consistent。厳密な会計ではなく
 * 総当たりの速度を落とすための仕組みなので、判定は次の方針で「通す」側に倒す。
 *   - 無効化フラグ（ADMIN_LOGIN_RATE_LIMIT=off）なら判定しない
 *   - binding が無い環境（ローカル開発・Pages プレビュー）では制限しない
 *   - binding が例外を投げたら制限しない（ログだけ残す）
 *   - 送信元 IP が取れなければ IP 段は飛ばし、全体段だけ適用する
 * 期間（60 秒）が過ぎればカウンタは自動で消えるので、恒久的なロックアウトは起きない。
 */

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AdminLoginRateLimiters {
  ipLimiter?: RateLimiterBinding;
  globalLimiter?: RateLimiterBinding;
}

export type AdminLoginRateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: "ip" | "global"; retryAfterSeconds: number };

/** wrangler の `simple.period` と揃える（10 か 60 のみ指定可） */
const RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * 緊急停止スイッチ。環境変数 ADMIN_LOGIN_RATE_LIMIT が "off"（大小・前後空白は無視）
 * のときだけ無効化する。それ以外の値（未設定・空・"on" など）は有効のまま。
 */
export function isAdminLoginRateLimitDisabled(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "off";
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
    return { allowed: true };
  }

  const { ipLimiter, globalLimiter } = input.limiters;
  const clientIp = input.clientIp?.trim();

  if (ipLimiter && clientIp) {
    const allowed = await consumeToken(ipLimiter, `ip:${clientIp}`, "ip");
    if (!allowed) {
      return { allowed: false, scope: "ip", retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS };
    }
  }

  if (globalLimiter) {
    const allowed = await consumeToken(globalLimiter, "global", "global");
    if (!allowed) {
      return { allowed: false, scope: "global", retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS };
    }
  }

  return { allowed: true };
}

/**
 * Cloudflare コンテキストから binding を取り出す。
 * akyo-data-kv.ts の getKVNamespace と同じく、コンテキストが無い環境では空を返す。
 */
export async function resolveAdminLoginRateLimiters(): Promise<AdminLoginRateLimiters> {
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
    if (!limiters.ipLimiter || !limiters.globalLimiter) {
      // 設定漏れで保護が黙って外れないよう、Workers ログに残す
      console.warn("[admin-login] rate limiter binding missing; login rate limiting is inactive");
    }
    return limiters;
  } catch {
    // ローカル開発・ビルド時・Pages プレビューなど、Cloudflare コンテキストが無い環境
    return {};
  }
}
