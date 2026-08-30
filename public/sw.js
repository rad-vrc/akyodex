/**
 * Akyodex Service Worker - Next.js Version
 *
 * Based on the original sw.js with adaptations for Next.js App Router
 *
 * Cache Strategy:
 * - HTML/Pages: Network First (always fetch latest)
 * - CSV Data: Network First with fallback
 * - API Routes: Network Only (never cache)
 * - Static Assets: Cache First with background update
 * - Images: Stale While Revalidate
 */

const CACHE_VERSION = 'akyodex-nextjs-v9';
const CACHE_NAME = `akyodex-cache-${CACHE_VERSION}`;

// Core files to precache on install
const PRECACHE_URLS = [
  '/about',
  '/offline',
  '/images/logo.webp',
  '/images/akyo-bg.webp',
  '/images/akyodexIcon-192.png',
  '/images/akyodexIcon-512.png',
];

/**
 * Get Service Worker scope
 */
function getScope() {
  return (self.registration && self.registration.scope) || self.location.href;
}

/**
 * Install Event - Precache core assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);

        // Precache core URLs with cache-busting
        // Use absolute URLs to ensure cache key consistency with fallback lookups
        await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            try {
              const absoluteUrl = new URL(url, self.location.origin).toString();
              const request = new Request(absoluteUrl, { cache: 'reload' });
              const response = await fetch(request);

              if (response && response.ok) {
                await cache.put(request, response.clone());
                console.log('[SW] Precached:', absoluteUrl);
              }
            } catch (error) {
              console.warn('[SW] Failed to precache:', url, error);
            }
          })
        );

        // Skip waiting to activate immediately
        await self.skipWaiting();
        console.log('[SW] Install complete');
      } catch (error) {
        console.error('[SW] Install failed:', error);
      }
    })()
  );
});

/**
 * Activate Event - Clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v' + CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        // Delete old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name.startsWith('akyodex-') && name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );

        // Take control of all clients immediately
        await self.clients.claim();
        console.log('[SW] Activate complete');
      } catch (error) {
        console.error('[SW] Activate failed:', error);
      }
    })()
  );
});

/**
 * Fetch Event - Intercept network requests with caching strategies
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Don't intercept cross-origin requests (R2, external APIs, etc.)
  if (url.origin !== self.location.origin) {
    return;
  }

  const accept = request.headers.get('accept') || '';

  // Let the browser handle navigations to avoid stale SW fallback
  if (request.mode === 'navigate' || accept.includes('text/html')) {
    return;
  }

  // Strategy 2a: Image Proxy API routes → treat as images (SWR)
  const IMAGE_API_PATHS = new Set(['/api/avatar-image', '/api/vrc-avatar-image']);
  if (IMAGE_API_PATHS.has(url.pathname)) {
    event.respondWith(handleImageRequest(event, request));
    return;
  }

  // Strategy 2b: Other API Routes - Network Only (never cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Strategy 3: CSV Data - Network First with cache fallback
  if (url.pathname === '/data/akyo-data-ja.csv' || url.pathname === '/data/akyo-data-en.csv') {
    event.respondWith(handleCsvRequest(request));
    return;
  }


  // Strategy 4a: App Icon/Manifest Assets - Network First with cache fallback
  if (isAppIconRequest(url, request)) {
    event.respondWith(handleIconRequest(request));
    return;
  }

  // Strategy 4b: Scripts/Styles - Network First with offline cache fallback
  // Prioritize this before /_next/static/ so JS/CSS are always fetched fresh first.
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(handleScriptStyleRequest(request));
    return;
  }

  // Strategy 4: Next.js Static Assets - Cache First (immutable)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleStaticAssets(event, request));
    return;
  }

  // Strategy 5: Images - Stale While Revalidate
  if (url.pathname.startsWith('/images/') || accept.includes('image/')) {
    event.respondWith(handleImageRequest(event, request));
    return;
  }

  // Strategy 6: Other Assets (CSS, JS) - Cache First with update
  event.respondWith(handleDefaultRequest(event, request));
});

/**
 * Strategy 1: HTML Navigation - Network First
 * Always try to fetch latest HTML, fallback to cache if offline
 */
async function handleNavigationRequest(request) {
  try {
    const url = new URL(request.url);
    const wantsFreshNavigation = url.searchParams.has('_akyoFresh');
    const requestToUse = wantsFreshNavigation ? new Request(request, { cache: 'reload' }) : request;

    const networkResponse = await fetch(requestToUse);
    if (networkResponse && networkResponse.ok) {
      return networkResponse;
    }
  } catch (error) {
    console.log('[SW] Navigation fetch failed:', error.message);
  }

  const cache = await caches.open(CACHE_NAME);
  const offline = await cache.match('/offline');
  if (offline) {
    return offline;
  }

  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - Akyodex</title></head>' +
      '<body><h1>オフラインです</h1><p>インターネット接続を確認してください。</p></body></html>',
    {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    }
  );
}

/**
 * Strategy 4b: Scripts/Styles - Network First with offline cache fallback
 * Always try network first; fallback to cache only on network errors.
 */
async function handleScriptStyleRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request, { cache: 'no-cache' });

    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed for script/style request:', error?.message || error);

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

/**
 * Strategy 2: API Routes - Network Only
 * Never cache API responses to ensure data freshness
 */
async function handleApiRequest(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'offline', message: 'API request failed - you are offline' }),
      {
        headers: { 'content-type': 'application/json' },
        status: 503,
      }
    );
  }
}

/**
 * Strategy 3: CSV Data - Network First with cache fallback
 * Always try to fetch latest CSV, use cache if offline
 */
async function handleCsvRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Always fetch fresh CSV data
    const networkResponse = await fetch(new Request(request, { cache: 'no-cache' }));

    if (networkResponse && networkResponse.ok) {
      // Update cache with fresh data
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.log('[SW] Network failed for CSV, trying cache:', error.message);
  }

  // Fallback to cached CSV
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // No cache available
  return new Response('', { status: 204 });
}


function isAppIconRequest(url, request) {
  const pathname = url.pathname;

  if (
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg' ||
    pathname === '/site.webmanifest' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/manifest.json'
  ) {
    return true;
  }

  if (pathname.startsWith('/images/')) {
    return /icon|apple-touch|favicon/i.test(pathname);
  }

  return request.destination === 'manifest' || pathname.endsWith('.webmanifest');
}

/**
 * Strategy 4a: App Icon/Manifest Assets - Network First
 * Keep tab/bookmark icons fresh, fallback to cache only when offline.
 */
async function handleIconRequest(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(new Request(request, { cache: 'reload' }));

    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }

    // Preserve actual HTTP status responses and fallback to cache only on true network failures.
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed for icon/manifest request:', error?.message || error);

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

/**
 * Strategy 4: Next.js Static Assets - Cache First (immutable)
 * Next.js static assets have content hashes, so they're immutable
 */
async function handleStaticAssets(event, request) {
  const cache = await caches.open(CACHE_NAME);

  // Try cache first
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    // Return cached, update in background
    event.waitUntil(updateCacheInBackground(cache, request));
    return cachedResponse;
  }

  // Fetch and cache
  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }

    // Preserve actual HTTP status responses (e.g., 404/500) instead of converting to network errors.
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed for static asset:', error?.message || error);
    throw error;
  }
}

/**
 * Strategy 5: Images - Stale While Revalidate
 * Return cached image immediately, update in background
 */
function isCacheableImageResponse(response) {
  if (!response) {
    return false;
  }

  const isDirectSuccess = response.ok && !response.redirected;
  if (!isDirectSuccess) {
    return false;
  }

  try {
    return new URL(response.url).pathname !== '/images/placeholder.webp';
  } catch {
    return false;
  }
}

async function handleImageRequest(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // If we have cache, return it immediately and refresh in background
  if (cached) {
    event.waitUntil(
      fetch(request)
        .then(async (resp) => {
          if (isCacheableImageResponse(resp)) {
            await cache.put(request, resp.clone());
          }
        })
        .catch(() => {})
    );
    return cached;
  }

  // No cache → hit network, return a non-cacheable 503 on network failure
  try {
    const resp = await fetch(request);
    if (isCacheableImageResponse(resp)) {
      await cache.put(request, resp.clone());
      return resp;
    }
    return resp;
  } catch (e) {
    console.log('[SW] Image fetch failed:', e?.message || e);
  }
  return new Response('', {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Strategy 6: Default - Cache First with background update
 * For other resources (fonts, etc.)
 */
async function handleDefaultRequest(event, request) {
  const cache = await caches.open(CACHE_NAME);

  // Try cache first
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Return cached, update in background
    event.waitUntil(updateCacheInBackground(cache, request));
    return cachedResponse;
  }

  // Fetch from network
  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }

    // Preserve actual HTTP status responses (e.g., 404/500) instead of converting to network errors.
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed for default request:', error?.message || error);
    throw error;
  }
}

/**
 * Background cache update helper
 */
async function updateCacheInBackground(cache, request) {
  try {
    const reloadRequest = new Request(request, { cache: 'reload' });
    const response = await fetch(reloadRequest);

    if (response && response.ok) {
      await cache.put(request, response.clone());
      console.log('[SW] Background updated:', request.url);
    }
  } catch (error) {
    // Silently fail - this is background update
  }
}

/**
 * Message Event - Handle messages from clients
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

// Global error handler for uncaught errors in Service Worker
self.addEventListener('error', (event) => {
  console.error('[SW] Uncaught error:', event.error?.message || event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});

// Log Service Worker lifecycle
console.log('[SW] Service Worker script loaded');
