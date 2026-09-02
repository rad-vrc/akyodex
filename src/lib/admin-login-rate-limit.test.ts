import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAdminLoginRateLimit,
  isAdminLoginRateLimitDisabled,
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

test("全体上限は IP が分散していても効く（分散総当たりの上限）", async () => {
  const ip = fakeLimiter(10);
  const global = fakeLimiter(3);
  const limiters = { ipLimiter: ip.limiter, globalLimiter: global.limiter };

  for (let i = 1; i <= 3; i += 1) {
    const result = await checkAdminLoginRateLimit({ clientIp: `203.0.113.${i}`, limiters, disabled: false });
    assert.equal(result.allowed, true);
  }
  const blocked = await checkAdminLoginRateLimit({ clientIp: "203.0.113.99", limiters, disabled: false });
  assert.deepEqual(blocked, { allowed: false, scope: "global", retryAfterSeconds: 60 });
  assert.deepEqual(global.calls, ["global", "global", "global", "global"]);
});

test("無効化フラグが立っていれば limiter を呼ばずに通す（緊急停止）", async () => {
  const ip = fakeLimiter(0);
  const global = fakeLimiter(0);
  const result = await checkAdminLoginRateLimit({
    clientIp: "203.0.113.10",
    limiters: { ipLimiter: ip.limiter, globalLimiter: global.limiter },
    disabled: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(ip.calls.length, 0);
  assert.equal(global.calls.length, 0);
});

test("binding が無い環境では制限しない（ローカル・Pages プレビュー）", async () => {
  const result = await checkAdminLoginRateLimit({ clientIp: "203.0.113.10", limiters: {}, disabled: false });
  assert.equal(result.allowed, true);
});

test("limiter が例外を投げても通す（fail-open）", async () => {
  const throwing: RateLimiterBinding = {
    async limit() {
      throw new Error("binding unavailable");
    },
  };
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const result = await checkAdminLoginRateLimit({
      clientIp: "203.0.113.10",
      limiters: { ipLimiter: throwing, globalLimiter: throwing },
      disabled: false,
    });
    assert.equal(result.allowed, true);
    assert.equal(warnings.length, 2, "IP 段・全体段それぞれで警告を残す");
  } finally {
    console.warn = originalWarn;
  }
});

test("送信元 IP が取れなければ IP 段を飛ばし、全体段だけ適用する", async () => {
  const ip = fakeLimiter(0);
  const global = fakeLimiter(1);
  const limiters = { ipLimiter: ip.limiter, globalLimiter: global.limiter };

  const first = await checkAdminLoginRateLimit({ clientIp: null, limiters, disabled: false });
  assert.equal(first.allowed, true);
  const second = await checkAdminLoginRateLimit({ clientIp: "   ", limiters, disabled: false });
  assert.deepEqual(second, { allowed: false, scope: "global", retryAfterSeconds: 60 });
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
