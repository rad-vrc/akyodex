/**
 * Avatar Image Proxy API
 *
 * Priority:
 * 1. R2 bucket (direct URL or binding)
 * 2. VRChat API (scrape) - using avtr ID from CSV if available
 * 3. Placeholder image
 *
 * Features:
 * - Image caching (1 hour via Cache-Control headers)
 * - Size optimization (w parameter)
 * - Fallback chain with CSV lookup
 */

import { connection } from 'next/server';
import { jsonError } from '@/lib/api-helpers';
import { VRCHAT_AVATAR_ID_PATTERN, extractVRChatAvatarIdFromUrl } from '@/lib/akyo-entry';

/**
 * Fetch CSV data and find avtr ID for given Akyo ID
 */
async function getAvtrIdFromCsv(akyoId: string): Promise<string | null> {
  try {
    const r2BaseUrl = process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com';
    const csvUrl = `${r2BaseUrl}/akyo-data/akyo-data-ja.csv`;

    const response = await fetch(csvUrl, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      console.log(`[avatar-image] CSV fetch failed: ${response.status}`);
      return null;
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');

    // Find the line with matching ID (CSV uses quoted cells "0001",...)
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const idMatch = trimmed.match(/^"?(\d{4})"?,/);
      if (!idMatch) continue;

      if (idMatch[1] === akyoId) {
        // Extract avtr ID from the AvatarURL column anywhere in the line.
        // The regex scans the full CSV line so it works regardless of column position.
        const urlMatch = line.match(/https:\/\/vrchat\.com\/home\/avatar\/(avtr_[A-Za-z0-9-]{1,64})/);
        if (urlMatch) {
          return urlMatch[1];
        }
        return null;
      }
    }

    return null;
  } catch (error) {
    console.log(`[avatar-image] CSV lookup error for ${akyoId}:`, error);
    return null;
  }
}

/**
 * GET /api/avatar-image?avtr=avtr_xxx&w=512
 * GET /api/avatar-image?id=0001&w=512
 */
export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);

  let avtr = searchParams.get('avtr');
  const id = searchParams.get('id');
  const widthParam = searchParams.get('w');

  // Parse width with proper fallback handling
  let width = 512; // Default width
  if (widthParam) {
    const parsed = parseInt(widthParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      width = Math.max(32, Math.min(4096, parsed));
    }
    // If invalid, use default 512
  }

  // Need either avtr or id
  if (!avtr && !id) {
    return jsonError('Missing avtr or id parameter', 400);
  }

  // Strengthen input validation for security
  if (avtr) {
    if (!VRCHAT_AVATAR_ID_PATTERN.test(avtr)) {
      return jsonError('Invalid avtr format', 400);
    }
  }

  let normalizedId: string | null = null;
  if (id) {
    // Accept IDs with 1-4 digits and normalize to 4 digits (e.g., 3 -> 0003)
    const idRegex = /^\d{1,4}$/;
    if (!idRegex.test(id)) {
      return jsonError('Invalid id format: must be numeric (up to 4 digits)', 400);
    }
    normalizedId = id.padStart(4, '0');
  }

  // If id is provided but no avtr, try to get avtr from CSV
  if (normalizedId && !avtr) {
    avtr = await getAvtrIdFromCsv(normalizedId);
    if (avtr) {
      console.log(`[avatar-image] Found avtr ${avtr} for ID ${normalizedId} from CSV`);
    }
  }

  try {
    console.log(`[avatar-image] Processing request: id=${id}, avtr=${avtr}, width=${width}`);

    // Step 1: Try R2 via direct URL (only if a normalized id exists)
    if (normalizedId) {
      const r2BaseUrl = process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com';
      const r2Url = `${r2BaseUrl}/${normalizedId}.webp`;

      try {
        // Create AbortController for 5-second timeout (shorter for faster fallback)
        const r2Controller = new AbortController();
        const r2TimeoutId = setTimeout(() => r2Controller.abort(), 5000);

        try {
          const r2Response = await fetch(r2Url, {
            signal: r2Controller.signal,
            next: { revalidate: 3600 }, // Cache for 1 hour
          });

          clearTimeout(r2TimeoutId);

          if (r2Response.ok) {
            // Stream the image through
            const imageData = await r2Response.arrayBuffer();
            return new Response(imageData, {
              status: 200,
              headers: {
                'Content-Type': r2Response.headers.get('Content-Type') || 'image/webp',
                'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
                'X-Image-Source': 'r2',
              },
            });
          } else {
            console.log(
              `[avatar-image] R2 returned ${r2Response.status} for ${id}, trying VRChat fallback`
            );
          }
        } catch (fetchError) {
          clearTimeout(r2TimeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            console.log(`[avatar-image] R2 fetch timeout for ${id}, trying VRChat fallback`);
          } else {
            console.log(`[avatar-image] R2 fetch error for ${id}:`, fetchError);
          }
        }
      } catch (error) {
        console.log(`[avatar-image] R2 fetch failed for ${id}, trying VRChat fallback:`, error);
      }
    }

    // Step 2: Try VRChat API if avtr is available (from parameter or CSV lookup)
    if (avtr) {
      // Validate avtr format
      const cleanAvtr = extractVRChatAvatarIdFromUrl(avtr);
      if (!cleanAvtr) {
        return jsonError('Invalid avtr format', 400);
      }

      // Security: Explicitly construct VRChat URL to prevent SSRF
      // Only allow vrchat.com domain
      const vrchatPageUrl = `https://vrchat.com/home/avatar/${cleanAvtr}`;

      // Validate URL is actually vrchat.com (defense in depth)
      const parsedUrl = new URL(vrchatPageUrl);
      if (parsedUrl.hostname !== 'vrchat.com') {
        return jsonError('Invalid domain', 400);
      }

      try {
        // Create AbortController for 30-second timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let html: string;
        try {
          const pageResponse = await fetch(vrchatPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'text/html',
            },
            signal: controller.signal,
            next: { revalidate: 21600 }, // Cache page for 6 hours
          });

          clearTimeout(timeoutId);

          if (!pageResponse.ok) {
            throw new Error(`VRChat page returned ${pageResponse.status}`);
          }

          html = await pageResponse.text();
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            throw new Error('VRChat page fetch timeout (30 seconds)');
          }
          throw fetchError;
        }

        // Extract image URL from OGP or API (validate domain during candidate selection)
        let imageUrl = '';

        // Helper: allowlist + HTTPS enforcement
        const allowed = new Set(['api.vrchat.cloud', 'files.vrchat.cloud', 'images.vrchat.cloud']);
        const isAllowedImageUrl = (url: string) => {
          try {
            const u = new URL(url);
            return u.protocol === 'https:' && allowed.has(u.hostname);
          } catch {
            return false;
          }
        };

        // 1. Try OGP image (with relative URL resolution and domain validation)
        const ogMatch = html.match(
          /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i
        );
        if (ogMatch?.[1]) {
          const candidate = ogMatch[1].startsWith('/')
            ? `https://vrchat.com${ogMatch[1]}`
            : ogMatch[1];
          if (isAllowedImageUrl(candidate)) {
            imageUrl = candidate;
          }
        }

        // 2. Try VRChat API URL (higher quality)
        if (!imageUrl) {
          const fileMatch = html.match(
            /https?:\/\/api\.vrchat\.cloud\/api\/1\/file\/(file_[A-Za-z0-9-]+)\/(\d+)\/file/i
          );
          if (fileMatch) {
            const fileId = fileMatch[1];
            imageUrl = `https://api.vrchat.cloud/api/1/image/${fileId}/1/${width}`;
          }
        }

        // 3. Try VRChat Files URL
        if (!imageUrl) {
          const filesMatch = html.match(
            /https?:\/\/files\.vrchat\.cloud\/thumbnails\/(file_[A-Za-z0-9-]+)[^"'\s]+\.thumbnail-\d+\.(png|jpg|webp)/i
          );
          if (filesMatch) {
            const fileId = filesMatch[1];
            imageUrl = `https://api.vrchat.cloud/api/1/image/${fileId}/1/${width}`;
          }
        }

        // Final lightweight guard (defense in depth)
        if (imageUrl && !isAllowedImageUrl(imageUrl)) {
          imageUrl = '';
        }

        if (imageUrl) {
          // Proxy the image with timeout
          const imageController = new AbortController();
          const imageTimeoutId = setTimeout(() => imageController.abort(), 30000);

          try {
            const imageResponse = await fetch(imageUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Accept: 'image/webp,image/png,image/*,*/*',
              },
              signal: imageController.signal,
              next: { revalidate: 3600 }, // Cache image for 1 hour
            });

            clearTimeout(imageTimeoutId);

            if (imageResponse.ok) {
              const imageData = await imageResponse.arrayBuffer();
              return new Response(imageData, {
                status: 200,
                headers: {
                  'Content-Type': imageResponse.headers.get('Content-Type') || 'image/webp',
                  'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
                  'X-Image-Source': 'vrchat',
                },
              });
            }
          } catch (imageFetchError) {
            clearTimeout(imageTimeoutId);
            if (imageFetchError instanceof Error && imageFetchError.name === 'AbortError') {
              console.warn(`[avatar-image] VRChat image fetch timeout for ${avtr}`);
            } else {
              throw imageFetchError;
            }
          }
        }
      } catch (error) {
        console.warn(`[avatar-image] VRChat fetch failed for ${avtr}:`, error);
      }
    }

    // Step 3: Return placeholder redirect
    console.log('[avatar-image] Returning placeholder redirect');
    const url = new URL(request.url);
    const placeholderUrl = `${url.protocol}//${url.host}/images/placeholder.webp`;
    console.log('[avatar-image] Placeholder URL:', placeholderUrl);
    return Response.redirect(placeholderUrl, 302);
  } catch (error) {
    console.error('[avatar-image] Unexpected error:', error);
    console.error('[avatar-image] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      avtr,
      id,
      width,
      url: request.url,
    });

    // Return detailed error in development
    if (process.env.NODE_ENV !== 'production') {
      return jsonError(
        `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }

    return jsonError('Internal Server Error', 500);
  }
}
