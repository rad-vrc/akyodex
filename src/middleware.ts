/**
 * Next.js Middleware
 *
 * Handles:
 * 1. Language detection (Cloudflare country, Accept-Language, Cookie)
 * 2. Admin route access (client component handles auth UI)
 * 3. CSP nonce generation for Content Security Policy
 *
 * NOTE: Middleware runs in Edge Runtime (Node.js APIs not available).
 * Security is maintained through:
 * - API routes validate HMAC-signed sessions (verify-session, login, CRUD)
 * - CSRF protection on all POST endpoints
 * - Client-side authentication checks in admin-client.tsx
 */

import { detectLanguageFromHeader, getLanguageFromCountry, isValidLanguage } from '@/lib/i18n';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const LANGUAGE_COOKIE = 'AKYO_LANG';

/** Cookie options shared across all language cookie calls */
const LANGUAGE_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 365, // 1 year
  path: '/',
  sameSite: 'lax' as const,
  // Only set secure=true in production to allow local persistence on http://localhost
  secure: process.env.NODE_ENV === 'production',
};

/**
 * Create a response with:
 * - CSP header on the response
 * - x-nonce/x-akyo-lang forwarded to request headers for App Router components
 */
function createSecuredResponse(
  request: NextRequest,
  cspHeader: string,
  nonce: string,
  lang?: string
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  if (lang) {
    requestHeaders.set('x-akyo-lang', lang);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('Content-Security-Policy', cspHeader);
  return response;
}

/**
 * CSP Source Constants
 * Refactored into arrays for easier maintenance.
 * Criteria for extraction:
 * - Directives containing external hosts that may change per deployment.
 * - Directives likely to require sharing or frequent updates.
 * - Complex lists where normalization (e.g. adding https://) is needed.
 */
const SCRIPT_SRC = [
  "'self'",
  'https://*.dify.dev',
  'https://*.dify.ai',
  'https://*.udify.app',
  'https://udify.app',
  'https://*.sentry.io',
  'https://analytics.google.com',
  'https://googletagmanager.com',
  'https://*.googletagmanager.com',
  'https://www.google-analytics.com',
  'https://paulrosen.github.io',
  'https://cdn-cookieyes.com',
  'https://fonts.googleapis.com',
];

// React development diagnostics reconstruct stack traces with eval(). Keep this
// development-only so the production policy never permits evaluated scripts.
const DEVELOPMENT_SCRIPT_SRC = process.env.NODE_ENV === 'production' ? [] : ["'unsafe-eval'"];

/**
 * Note: 'unsafe-inline' is required for style-src because:
 * 1. React's inline 'style={{...}}' attributes are used extensively throughout the app.
 * 2. Browsers ignore 'unsafe-inline' if a nonce is present, which would block React attributes.
 * 3. Third-party widgets (Dify, Sentry) also depend on inline styles.
 */
const STYLE_SRC = [
  "'self'",
  "'unsafe-inline'",
  'https://udify.app',
  'https://*.udify.app',
  'https://fonts.googleapis.com',
];

/**
 * Note: Broad 'https:' source was removed to harden the policy.
 * Only explicit image hosts are allowed here.
 */
const IMG_SRC = [
  "'self'",
  'data:',
  'blob:',
  'https://imagedelivery.net',
  'https://*.imagedelivery.net',
  'https://*.akyodex.com',
  'https://*.vrchat.com',
  'https://*.vrcimg.com',
  'https://*.r2.cloudflarestorage.com',
  'https://udify.app',
  'https://*.udify.app',
];

const CONNECT_SRC = [
  "'self'",
  'https://*.dify.dev',
  'https://*.dify.ai',
  'https://*.udify.app',
  'https://udify.app',
  'https://*.r2.cloudflarestorage.com',
  'https://*.sentry.io',
  'https://analytics.google.com',
  'https://www.google-analytics.com',
  'https://api.github.com', // Data endpoint (moved from SCRIPT_SRC as it doesn't host script)
  'https://images.akyodex.com',
];

const FONT_SRC = [
  "'self'",
  'data:',
  'https://udify.app',
  'https://*.udify.app',
  'https://fonts.gstatic.com',
];

const FRAME_SRC = [
  "'self'",
  'https://udify.app',
  'https://*.udify.app',
];

const MEDIA_SRC = [
  "'self'",
  'data:',
  'mediastream:',
  'blob:',
];

const WORKER_SRC = [
  "'self'",
  'blob:',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * Defensive check: redundant path exclusion.
   * While the 'matcher' in the config handles most exclusions, this block
   * serves as a defensive fallback to ensure static assets and API routes
   * are never processed by the middleware logic.
   *
   * ASSUMPTION:
   * - API routes (/api/*) are expected to return JSON only. If any API returns HTML
   *   in the future, CSP headers must be manually applied or this block updated.
   * - Static assets (with extensions) are bypassed to avoid CSP overhead.
   *
   * TODO: Audit and apply CSP for any HTML-returning API endpoints (e.g. OGP handlers).
   */
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/images') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Generate nonce for CSP
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...randomBytes));

  // Content Security Policy
  // Note: Allow known inline snippets via hash.
  // - difyHash: Dify bootstrap (external script interaction)
  const difyHash = "'sha256-r53Kt4G9CFjqxyzu6MVglOzjs5vcCE7jOdc6JGC6cC4='";

  const cspHeader = `
    default-src 'self';
    script-src ${[...SCRIPT_SRC, ...DEVELOPMENT_SCRIPT_SRC].join(' ')} 'nonce-${nonce}' ${difyHash};
    style-src ${STYLE_SRC.join(' ')};
    img-src ${IMG_SRC.join(' ')};
    font-src ${FONT_SRC.join(' ')};
    connect-src ${CONNECT_SRC.join(' ')};
    frame-src ${FRAME_SRC.join(' ')};
    worker-src ${WORKER_SRC.join(' ')};
    media-src ${MEDIA_SRC.join(' ')};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'self';
    ${process.env.NODE_ENV === 'production' ? 'upgrade-insecure-requests;' : ''}
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Allow /admin routes to load (client component handles auth UI)
  if (pathname.startsWith('/admin')) {
    return createSecuredResponse(request, cspHeader, nonce);
  }

  // Language detection for all other routes
  // 1. Check cookie (user preference)
  const cookieLang = request.cookies.get(LANGUAGE_COOKIE)?.value;
  if (cookieLang && isValidLanguage(cookieLang)) {
    const response = createSecuredResponse(request, cspHeader, nonce, cookieLang);
    // Refresh cookie expiry to maintain persistence
    response.cookies.set(LANGUAGE_COOKIE, cookieLang, LANGUAGE_COOKIE_OPTIONS);
    return response;
  }

  // 2. Check Cloudflare country header (most accurate)
  const cfCountry = request.headers.get('cf-ipcountry');
  if (cfCountry) {
    const langFromCountry = getLanguageFromCountry(cfCountry);
    const response = createSecuredResponse(request, cspHeader, nonce, langFromCountry);
    response.cookies.set(LANGUAGE_COOKIE, langFromCountry, LANGUAGE_COOKIE_OPTIONS);
    return response;
  }

  // 3. Check Accept-Language header
  const acceptLanguage = request.headers.get('accept-language');
  const detectedLang = detectLanguageFromHeader(acceptLanguage);

  const response = createSecuredResponse(request, cspHeader, nonce, detectedLang);
  response.cookies.set(LANGUAGE_COOKIE, detectedLang, LANGUAGE_COOKIE_OPTIONS);
  return response;
}

export const config = {
  matcher: [
    {
      // Match all routes except static files and API routes
      source: '/((?!_next|api|images|.*\\.).*)',
      // Skip middleware execution for Next.js prefetch requests
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
