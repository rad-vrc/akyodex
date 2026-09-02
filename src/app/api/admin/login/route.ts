/**
 * API Route: Admin Login
 * POST /api/admin/login
 * Body: { password: string }
 * Returns: { success: boolean, role?: 'owner' | 'admin', message?: string }
 *
 * Server-side authentication endpoint to prevent client-side password exposure.
 * Creates a secure session cookie on successful authentication.
 * Rate limited per client IP and globally (see src/lib/admin-login-rate-limit.ts);
 * returns 429 with Retry-After when the budget for the current minute is spent.
 */

import { connection } from 'next/server';
import {
  checkAdminLoginRateLimit,
  isAdminLoginRateLimitDisabled,
  resolveAdminLoginRateLimiters,
} from '@/lib/admin-login-rate-limit';
import { jsonError, jsonSuccess, setSessionCookie, timingSafeCompare } from '@/lib/api-helpers';
import { createSessionToken } from '@/lib/session';
import type { AdminRole } from '@/types/akyo';

// Session duration: 24 hours
const SESSION_DURATION = 24 * 60 * 60 * 1000;
const MAX_AKYO_WORD_LENGTH = 256;

export async function POST(request: Request) {
  await connection();
  try {
    // 総当たり対策のレート制限（IP 単位 名目 10 回/分で遮断、全体 名目 60 回/分は監視専用）。
    // パスワード照合の前に判定し、成功・失敗を問わず 1 試行として数える。binding が無い・
    // 失敗した・ADMIN_LOGIN_RATE_LIMIT=off のときは制限せず通す（正当な管理者を締め出さない）。
    const rateLimit = await checkAdminLoginRateLimit({
      clientIp: request.headers.get('cf-connecting-ip'),
      limiters: await resolveAdminLoginRateLimiters(),
      disabled: isAdminLoginRateLimitDisabled(process.env.ADMIN_LOGIN_RATE_LIMIT),
    });
    if (!rateLimit.allowed) {
      console.warn(`[admin-login] rate limited (${rateLimit.scope})`);
      return jsonError(
        'ログイン試行が多すぎます。しばらく待ってから再度お試しください',
        429,
        { retryAfterSeconds: rateLimit.retryAfterSeconds },
        { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      );
    }
    if (rateLimit.globalBudgetExceeded) {
      // 全体段は監視専用: 分散攻撃の兆候をログに残すだけで、遮断はしない
      console.warn('[admin-login] global login budget exceeded (monitor only; request allowed)');
    }

    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return jsonError('Akyoワードを入力してください', 400);
    }
    if (password.length > MAX_AKYO_WORD_LENGTH) {
      return jsonError(`Akyoワードは${MAX_AKYO_WORD_LENGTH}文字以内で入力してください`, 400);
    }

    // Get passwords from environment variables (server-side only - NOT NEXT_PUBLIC)
    const ownerPassword = process.env.ADMIN_PASSWORD_OWNER;
    const adminPassword = process.env.ADMIN_PASSWORD_ADMIN;

    // Validate that passwords are configured
    if (!ownerPassword || !adminPassword) {
      console.error('Admin passwords not configured in environment variables');
      return jsonError('認証設定エラーです', 500);
    }

    // Check password and determine role using timing-safe comparison
    // Initialize role to null. Both password checks are performed before assigning a role to prevent timing-based role detection.
    let role: AdminRole | null = null;
    let username = '';

    // Always check both passwords to prevent timing-based role detection
    const isOwner = timingSafeCompare(password, ownerPassword);
    const isAdmin = timingSafeCompare(password, adminPassword);

    if (isOwner) {
      role = 'owner';
      username = 'rado'; // Owner username
    } else if (isAdmin) {
      role = 'admin';
      username = 'admin'; // Admin username
    }

    if (!role) {
      return jsonError('Akyoワードが違います', 401);
    }

    // Create cryptographically signed session token
    const sessionToken = await createSessionToken(username, role, SESSION_DURATION);

    // Set secure HTTP-only cookie using helper
    await setSessionCookie(sessionToken, SESSION_DURATION / 1000);

    return jsonSuccess({
      role,
      message: 'ログインしました',
    });
  } catch (error) {
    console.error('Login error:', error);
    return jsonError('ログインエラーが発生しました', 500);
  }
}
