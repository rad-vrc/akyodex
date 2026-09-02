import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAdminLoginRateLimit,
  isAdminLoginRateLimitDisabled,
  resolveAdminLoginRateLimiters,
  shouldReportRateLimiterFailure,
  type RateLimiterBinding,
} from "./admin-login-rate-limit";

/** wrangler の simple limiter を模したもの: キーごとに limit 回まで success */
function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const limiter: RateLimiterBinding = {
    async limit({ key }) {
      calls.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
  return { limiter, calls };
}

/** console.warn を捕まえて呼び出しを返す */
async function captureWarnings(run: () => Promise<void>): Promise<unknown[][]> {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

test("IP ごとに 10 回目まで通り 11 回目で拒否、別 IP は独立した予算を持つ", async () => {
  const ip = fakeLimiter(10);
  const global = fakeLimiter(60);
  const limiters = { ipLimiter: ip.limiter, globalLimiter: global.limiter };

  for (let i = 1; i <= 10; i += 1) {
    const result = await checkAdminLoginRateLimit({ clientIp: "203.0.113.10", limiters, disabled: false });
    assert.equal(result.allowed, true, `${i} 回目は通る`);
  }
  const blocked = await checkAdminLoginRateLimit({ clientIp: "203.0.113.10", limiters, disabled: false });
  assert.deepEqual(blocked, { allowed: false, scope: "ip", retryAfterSeconds: 60 });

  // 別 IP は影響を受けない
  const other = await checkAdminLoginRateLimit({ clientIp: "198.51.100.7", limiters, disabled: false });
  assert.equal(other.allowed, true);

  // IP 段で拒否したときは全体段のトークンを消費しない
  assert.equal(global.calls.length, 11, "通った 11 回分だけ全体段を消費する");
  assert.ok(ip.calls.every((key) => key.startsWith("ip:")));
});

test("全体段は監視専用: 予算を超えても遮断せず globalBudgetExceeded だけ立てる", async () => {
  const ip = fakeLimiter(10);
  const global = fakeLimiter(3);
  const limiters = { ipLimiter: ip.limiter, globalLimiter: global.limiter };

  for (let i = 1; i <= 3; i += 1) {
    const result = await checkAdminLoginRateLimit({ clientIp: `203.0.113.${i}`, limiters, disabled: false });
    assert.deepEqual(result, { allowed: true, globalBudgetExceeded: false });
  }
  // 4 件目以降: 多数の IP から攻撃が続いても、正当な管理者の新規ログインは通る
  for (let i = 4; i <= 6; i += 1) {
    const result = await checkAdminLoginRateLimit({ clientIp: `203.0.113.${i}`, limiters, disabled: false });
    assert.deepEqual(result, { allowed: true, globalBudgetExceeded: true });
  }
  assert.equal(global.calls.length, 6, "全体段は消費し続ける（監視のため）");
});

test("無効化フラグが立っていれば limiter を呼ばずに通す（緊急停止）", async () => {
  const ip = fakeLimiter(0);
  const global = fakeLimiter(0);
  const result = await checkAdminLoginRateLimit({
    clientIp: "203.0.113.10",
    limiters: { ipLimiter: ip.limiter, globalLimiter: global.limiter },
    disabled: true,
  });
  assert.deepEqual(result, { allowed: true, globalBudgetExceeded: false });
  assert.equal(ip.calls.length, 0);
  assert.equal(global.calls.length, 0);
});

test("binding が無い環境では制限しない（ローカル・Pages プレビュー）", async () => {
  const result = await checkAdminLoginRateLimit({ clientIp: "203.0.113.10", limiters: {}, disabled: false });
  assert.deepEqual(result, { allowed: true, globalBudgetExceeded: false });
});

test("limiter が例外を投げても通す（fail-open）", async () => {
  const throwing: RateLimiterBinding = {
    async limit() {
      throw new Error("binding unavailable");
    },
  };
  const warnings = await captureWarnings(async () => {
    const result = await checkAdminLoginRateLimit({
      clientIp: "203.0.113.10",
      limiters: { ipLimiter: throwing, globalLimiter: throwing },
      disabled: false,
    });
    assert.deepEqual(result, { allowed: true, globalBudgetExceeded: false });
  });
  assert.equal(warnings.length, 2, "IP 段・全体段それぞれで警告を残す");
});

test("送信元 IP が取れなければ IP 段を飛ばし、全体段は監視だけ行う", async () => {
  const ip = fakeLimiter(0);
  const global = fakeLimiter(1);
  const limiters = { ipLimiter: ip.limiter, globalLimiter: global.limiter };

  const first = await checkAdminLoginRateLimit({ clientIp: null, limiters, disabled: false });
  assert.deepEqual(first, { allowed: true, globalBudgetExceeded: false });
  const second = await checkAdminLoginRateLimit({ clientIp: "   ", limiters, disabled: false });
  assert.deepEqual(second, { allowed: true, globalBudgetExceeded: true });
  assert.equal(ip.calls.length, 0, "IP 段は呼ばれない");
});

test("isAdminLoginRateLimitDisabled は 'off' だけを無効化として扱う", () => {
  assert.equal(isAdminLoginRateLimitDisabled("off"), true);
  assert.equal(isAdminLoginRateLimitDisabled(" OFF "), true);
  assert.equal(isAdminLoginRateLimitDisabled("Off"), true);
  assert.equal(isAdminLoginRateLimitDisabled(undefined), false);
  assert.equal(isAdminLoginRateLimitDisabled(""), false);
  assert.equal(isAdminLoginRateLimitDisabled("on"), false);
  assert.equal(isAdminLoginRateLimitDisabled("false"), false);
  assert.equal(isAdminLoginRateLimitDisabled("0"), false);
});

test("shouldReportRateLimiterFailure は Workers ターゲットのときだけ true", () => {
  assert.equal(shouldReportRateLimiterFailure("workers"), true);
  assert.equal(shouldReportRateLimiterFailure(" Workers "), true);
  assert.equal(shouldReportRateLimiterFailure("pages"), false);
  assert.equal(shouldReportRateLimiterFailure(""), false);
  assert.equal(shouldReportRateLimiterFailure(undefined), false);
});

test("Cloudflare コンテキストが無いとき: Workers ターゲットなら警告して空を返し、それ以外は静かに空を返す", async () => {
  // node:test 上には Cloudflare コンテキストが無いので、取得は必ず失敗する（catch 経路）
  const reported = await captureWarnings(async () => {
    const limiters = await resolveAdminLoginRateLimiters({ deployTarget: "workers" });
    assert.deepEqual(limiters, {});
  });
  assert.equal(reported.length, 1, "Workers 上では fail-open の痕跡を残す");
  assert.match(String(reported[0][0]), /login rate limiting is inactive/);

  const silent = await captureWarnings(async () => {
    const limiters = await resolveAdminLoginRateLimiters({ deployTarget: "" });
    assert.deepEqual(limiters, {});
  });
  assert.equal(silent.length, 0, "ローカル・Pages では警告しない");
});
