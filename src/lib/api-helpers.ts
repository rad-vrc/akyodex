/**
 * API Route Helpers
 *
 * Common utilities for API routes including session validation and CSRF protection.
 */

import {
  createHash,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { AkyoEntryType } from "@/types/akyo";
import { detectVrcEntryTypeFromUrl } from "./akyo-entry";
import {
  SessionData,
  validateSession as validateSessionToken,
} from "./session";
import { validateBoothUrl } from "./booth-url";

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional input validation for control chars
export const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;

/**
 * Timing-safe string comparison (Edge / Cloudflare Workers compatible)
 *
 * Uses the native crypto.subtle.timingSafeEqual provided by the
 * Cloudflare Workers runtime for a true constant-time comparison
 * implemented at the C++ level, immune to JIT optimisations.
 *
 * When lengths differ, compares the user value against itself (always
 * true) and negates the result, following the Cloudflare-recommended
 * pattern so that the comparison cost stays constant regardless of
 * input length.  This avoids leaking the secret's length via timing.
 *
 * @see https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/
 * @param a - First string  (typically the user-supplied value)
 * @param b - Second string (typically the server secret)
 * @returns true if strings are equal, false otherwise
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    const subtle = crypto.subtle as SubtleCrypto & {
      timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
    };

    // crypto.subtle.timingSafeEqual throws when lengths differ.
    // Compare user input against itself (constant-time no-op) and
    // negate so that length mismatches never leak timing information.
    const lengthsMatch = bufA.byteLength === bufB.byteLength;
    if (typeof subtle.timingSafeEqual === "function") {
      return lengthsMatch
        ? subtle.timingSafeEqual(bufA, bufB)
        : !subtle.timingSafeEqual(bufA, bufA);
    }

    const digestA = createTimingSafeDigest(a);
    const digestB = createTimingSafeDigest(b);
    return nodeTimingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

export function createTimingSafeDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Validate session from request cookies
 *
 * @returns SessionData if valid, null otherwise
 */
export async function validateSession(): Promise<SessionData | null> {
  try {
    await connection();
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("admin_session")?.value;

    if (!sessionToken) {
      return null;
    }

    return await validateSessionToken(sessionToken);
  } catch (error) {
    console.error("Session validation error:", error);
    return null;
  }
}

/**
 * Returns a standardized JSON error response
 * IMPORTANT: Maintains { success: false, error } format for frontend compatibility
 * @param message - User-friendly error message
 * @param status - HTTP status code (default: 400)
 * @param extra - Additional fields to include in response
 * @returns Response object with error structure
 */
export function jsonError(
  message: string,
  status: number = 400,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { success: false, error: message, ...extra },
    { status },
  );
}

/**
 * Returns a standardized JSON success response
 * IMPORTANT: Maintains { success: true, ...data } format for frontend compatibility
 * @param data - Response data (will be spread into response)
 * @param status - HTTP status code (default: 200)
 * @returns Response object with success structure
 */
export function jsonSuccess<T extends Record<string, unknown>>(
  data: T,
  status: number = 200,
  init?: Omit<ResponseInit, "status">,
): Response {
  return Response.json({ success: true, ...data }, { ...init, status });
}

/**
 * Convert thrown API errors into standardized JSON error responses
 * @param error - Unknown thrown error
 * @param fallbackMessage - Fallback message when error is not an Error instance
 * @returns Response object with inferred HTTP status
 */
export function getApiErrorResponse(
  error: unknown,
  fallbackMessage: string,
): Response {
  const message = error instanceof Error ? error.message : fallbackMessage;

  if (error instanceof Error) {
    const statusMatch = error.message.match(/returned (\d{3})/);
    if (statusMatch) {
      return jsonError(error.message, Number.parseInt(statusMatch[1], 10));
    }

    if (/timeout/i.test(error.message)) {
      return jsonError(error.message, 504);
    }
  }

  return jsonError(message, 500);
}

/**
 * Ensure admin authentication and authorization
 * Updated to work with standard Request (not NextRequest)
 * @param request - Standard Request object
 * @param options - Validation options
 * @returns Session data or error response
 */
export async function ensureAdminRequest(
  request: Request,
  options: {
    requireOrigin?: boolean;
    requireOwner?: boolean;
    ownerErrorMessage?: string;
  } = {},
): Promise<{ session: SessionData } | { response: Response }> {
  const {
    requireOrigin = true,
    requireOwner = false,
    ownerErrorMessage = "この操作は所有者のみが可能です",
  } = options;

  if (requireOrigin && !validateOrigin(request)) {
    return {
      response: jsonError("不正なリクエスト元です", 403),
    };
  }

  const session = await validateSession();
  if (!session) {
    return {
      response: jsonError("認証が必要です", 401),
    };
  }

  if (requireOwner && session.role !== "owner") {
    return {
      response: jsonError(ownerErrorMessage, 403),
    };
  }

  return { session };
}

/**
 * Validate CSRF protection via Origin/Referer headers
 * Updated to work with standard Request (not NextRequest)
 * @param request - Standard Request object
 * @returns true if valid origin, false otherwise
 */
export function validateOrigin(request: Request): boolean {
  let allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN;
  const allowDevHosts = process.env.CSRF_DEV_ALLOWLIST === "true";

  if (!allowedOrigin) {
    // Fallback: trust the current host (same-origin) to avoid lockout if env vars are missing
    try {
      allowedOrigin = new URL(request.url).origin;
      console.warn(
        "⚠️ CSRF protection: NEXT_PUBLIC_APP_URL/APP_ORIGIN 未設定のため request.url.origin を暫定使用します:",
        allowedOrigin,
      );
    } catch {
      if (process.env.NODE_ENV !== "production" || allowDevHosts) {
        console.warn(
          "⚠️ CSRF protection disabled - set NEXT_PUBLIC_APP_URL or APP_ORIGIN",
        );
        return true;
      }
      console.error(
        "CSRF protection: APP_ORIGIN not configured and request.origin parse failed",
      );
      return false;
    }
  }

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  const canonical = (value: string) => {
    try {
      return new URL(value).origin;
    } catch {
      return value;
    }
  };

  const allowedOriginCanonical = canonical(allowedOrigin);

  const isLocalhostMatch = (value: string | null) => {
    if (!value || !allowDevHosts) {
      return false;
    }
    try {
      const allowed = new URL(allowedOriginCanonical);
      const candidate = new URL(value);
      const localHosts = new Set(["localhost", "127.0.0.1"]);
      return (
        localHosts.has(allowed.hostname) && localHosts.has(candidate.hostname)
      );
    } catch {
      return false;
    }
  };

  const matchesAllowed = (value: string | null) => {
    if (!value) {
      return false;
    }
    try {
      const parsed = new URL(value);
      if (parsed.origin === allowedOriginCanonical) {
        return true;
      }
    } catch (error) {
      console.error(`CSRF protection: Malformed origin ${value}`, error);
      return false;
    }
    return isLocalhostMatch(value);
  };

  // Check Origin header (preferred)
  if (originHeader) {
    if (matchesAllowed(originHeader)) {
      return true;
    }
    console.error(`CSRF protection: Invalid origin ${originHeader}`);
    return false;
  }

  // Fallback to Referer header
  if (refererHeader) {
    if (matchesAllowed(refererHeader)) {
      return true;
    }
    console.error(`CSRF protection: Invalid referer ${refererHeader}`);
    return false;
  }

  // No origin or referer header: allow only if request host matches allowed origin host
  try {
    const requestOrigin = new URL(request.url).origin;
    const allowedHost = new URL(allowedOriginCanonical).host;
    const requestHost = new URL(requestOrigin).host;
    if (requestHost === allowedHost) {
      console.warn(
        "⚠️ CSRF protection: Missing origin/referer, but request host matches allowed origin host. Allowing.",
      );
      return true;
    }
  } catch (error) {
    console.error(
      "CSRF protection: Missing origin/referer and request URL parse failed",
      error,
    );
  }

  console.error("CSRF protection: Missing origin and referer headers");
  return false;
}

/**
 * Validate Akyo ID format (4-digit string)
 * @param id - Akyo ID to validate
 * @returns true if valid 4-digit format, false otherwise
 */
export function validateAkyoId(id: string): boolean {
  return /^\d{4}$/.test(id);
}

export interface AkyoFormData {
  id: string;
  nickname: string;
  avatarName: string;
  entryType: AkyoEntryType | '';
  displaySerial?: string;
  sourceUrl: string;
  boothUrl?: string;

  // 新フィールド
  category: string;
  author: string;
  comment: string;

  // 旧フィールド（互換性維持のため）
  /** @deprecated use category */
  attributes: string;
  /** @deprecated use author */
  creator: string;
  /** @deprecated use comment */
  notes: string;

  avatarUrl: string;
  imageData?: string;
}

export type AkyoFormParseResult =
  | { success: true; data: AkyoFormData }
  | { success: false; status: number; error: string };

/**
 * Set session cookie with secure configuration
 * @param token - JWT session token
 * @param maxAge - Cookie max age in seconds (default: 7 days)
 */
export async function setSessionCookie(
  token: string,
  maxAge: number = 60 * 60 * 24 * 7,
): Promise<void> {
  await connection();
  const cookieStore = await cookies();

  cookieStore.set("admin_session", token, {
    httpOnly: true, // Prevent XSS
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: "strict", // CSRF protection
    maxAge, // 7 days default
    path: "/",
  });
}

/**
 * Clear session cookie (logout)
 */
export async function clearSessionCookie(): Promise<void> {
  await connection();
  const cookieStore = await cookies();
  cookieStore.delete("admin_session");
}

export function parseAkyoFormData(formData: FormData): AkyoFormParseResult {
  const readField = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  const id = readField("id");
  const entryTypeRaw = readField("entryType");
  let entryType: AkyoEntryType | '' = "avatar";
  if (entryTypeRaw) {
    if (entryTypeRaw === "avatar" || entryTypeRaw === "world") {
      entryType = entryTypeRaw;
    } else {
      return {
        success: false,
        status: 400,
        error: "entryType は avatar または world である必要があります",
      };
    }
  }
  const displaySerial = readField("displaySerial") || undefined;
  const avatarName = readField("avatarName");
  const nickname = readField("nickname");
  const sourceUrl = readField("sourceUrl") || readField("avatarUrl");

  // 新旧フィールドの両方をサポート
  // 優先順位: author (新) > creator (旧)
  const author = readField("author") || readField("creator");

  const rawBoothUrl = readField("boothUrl");
  const boothUrl = rawBoothUrl ? validateBoothUrl(rawBoothUrl) : undefined;
  if (rawBoothUrl && !boothUrl) {
    return {
      success: false,
      status: 400,
      error: "boothUrl は https://booth.pm または https://*.booth.pm のURLである必要があります",
    };
  }

  // BOOTH専用モード: sourceUrlなし && boothUrlあり
  const isBoothOnly = !sourceUrl && !!boothUrl;

  if (isBoothOnly) {
    // BOOTH専用: nickname（名前）が必須
    if (!id || !nickname || !author) {
      return {
        success: false,
        status: 400,
        error: "BOOTH専用登録には名前、作者、BOOTH URLが必要です",
      };
    }
    entryType = '';
  } else {
    // 通常モード
    if (
      !id ||
      !author ||
      !sourceUrl ||
      (entryType === "avatar" && !avatarName) ||
      (entryType === "world" && !nickname)
    ) {
      return {
        success: false,
        status: 400,
        error: "必須フィールドが不足しています",
      };
    }
  }

  if (!validateAkyoId(id)) {
    return {
      success: false,
      status: 400,
      error: "有効な4桁ID（0001-9999）が必要です",
    };
  }

  // BOOTH専用時はsourceUrl/entryType整合性チェックをスキップ
  if (!isBoothOnly && detectVrcEntryTypeFromUrl(sourceUrl) !== entryType) {
    return {
      success: false,
      status: 400,
      error: "entryType と sourceUrl の種別が一致していません",
    };
  }

  const imageValue = formData.get("imageData");
  const imageData =
    typeof imageValue === "string" && imageValue.trim().length > 0
      ? imageValue.trim()
      : undefined;

  // 他のフィールドも新旧両方から取得
  const category = readField("category") || readField("attributes");
  const comment = readField("comment") || readField("notes");

  return {
    success: true,
    data: {
      id,
      entryType,
      displaySerial,
      avatarName,
      nickname,
      sourceUrl,
      boothUrl,
      avatarUrl: readField("avatarUrl") || sourceUrl,
      imageData,

      // 新フィールド
      author,
      category,
      comment,

      // 旧フィールド (互換性維持)
      creator: author,
      attributes: category,
      notes: comment,
    },
  };
}
