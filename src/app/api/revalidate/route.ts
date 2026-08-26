import { connection } from 'next/server';
import { CONTROL_CHARACTER_PATTERN, jsonError, jsonSuccess, timingSafeCompare } from '@/lib/api-helpers';
import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * On-demand ISR Revalidation API
 *
 * Phase 5a: ISR cache invalidation
 * Phase 5b: KV cache update
 *
 * This endpoint allows external services (like GitHub Actions) to trigger
 * cache invalidation after data updates, enabling near-instant updates
 * instead of waiting for the ISR revalidation period (1 hour).
 *
 * Security:
 * - Requires REVALIDATE_SECRET header for authentication
 * - Should only be called from trusted sources (GitHub Actions webhook)
 *
 * Usage:
 * POST /api/revalidate
 * Headers:
 *   x-revalidate-secret: <REVALIDATE_SECRET>
 * Body (optional):
 *   {
 *     "paths": ["/", "/en"],
 *     "tags": ["akyo-data"],
 *     "updateKV": true  // Phase 5b: Also update KV cache
 *   }
 * Note:
 * - If paths/tags are omitted, default values are used.
 * - If paths/tags are provided, they must be non-empty arrays.
 *
 * If no body is provided, revalidates all main pages by default.
 *
 * Environment Variables:
 * - REVALIDATE_SECRET: Secret token for authentication (required)
 */

interface RevalidateRequest {
  paths?: string[];
  tags?: string[];
  updateKV?: boolean; // Phase 5b: Also update KV cache with fresh data
}

// Default paths to revalidate when no specific paths are provided
const DEFAULT_PATHS = [
  '/', // Japanese home
  '/en', // English home
  '/ko', // Korean home
  '/zukan', // Complete catalog initial payload
];

// Default tags to revalidate
const DEFAULT_TAGS = ['akyo-data', 'akyo-data-ja', 'akyo-data-en', 'akyo-data-ko'];
const MAX_PATHS = 20;
const MAX_TAGS = 20;
const MAX_PATH_LENGTH = 200;
const MAX_TAG_LENGTH = 120;

function parseStringArray(
  value: unknown,
  {
    maxItems,
    maxItemLength,
    mustStartWithSlash,
  }: { maxItems: number; maxItemLength: number; mustStartWithSlash: boolean }
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) {
    return null;
  }

  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return null;
    }
    const normalized = item.trim();
    if (
      normalized.length === 0 ||
      normalized.length > maxItemLength ||
      CONTROL_CHARACTER_PATTERN.test(normalized)
    ) {
      return null;
    }
    if (mustStartWithSlash && !normalized.startsWith('/')) {
      return null;
    }
    parsed.push(normalized);
  }
  return parsed;
}

export async function POST(request: Request): Promise<Response> {
  await connection();
  try {
    // Verify secret
    const secret = request.headers.get('x-revalidate-secret');
    const expectedSecret = process.env.REVALIDATE_SECRET;

    if (!expectedSecret) {
      console.error('[revalidate] REVALIDATE_SECRET is not configured');
      return jsonError('Server configuration error', 500);
    }

    if (!secret || !timingSafeCompare(secret, expectedSecret)) {
      console.warn('[revalidate] Invalid or missing secret');
      return jsonError('Invalid secret', 401);
    }

    // Parse request body (optional)
    let paths = DEFAULT_PATHS;
    let tags = DEFAULT_TAGS;
    let updateKV = false;
    let parsedBody: unknown = {};

    try {
      parsedBody = await request.json();
    } catch {
      // No body or invalid JSON - use defaults
    }

    const body: RevalidateRequest =
      parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
        ? (parsedBody as RevalidateRequest)
        : {};

    if (body.paths !== undefined) {
      const parsedPaths = parseStringArray(body.paths, {
        maxItems: MAX_PATHS,
        maxItemLength: MAX_PATH_LENGTH,
        mustStartWithSlash: true,
      });
      if (!parsedPaths) {
        return jsonError('Invalid paths format', 400);
      }
      if (parsedPaths.length === 0) {
        return jsonError('paths cannot be empty when provided', 400);
      }
      paths = parsedPaths;
    }

    if (body.tags !== undefined) {
      const parsedTags = parseStringArray(body.tags, {
        maxItems: MAX_TAGS,
        maxItemLength: MAX_TAG_LENGTH,
        mustStartWithSlash: false,
      });
      if (!parsedTags) {
        return jsonError('Invalid tags format', 400);
      }
      if (parsedTags.length === 0) {
        return jsonError('tags cannot be empty when provided', 400);
      }
      tags = parsedTags;
    }

    if (body.updateKV !== undefined && typeof body.updateKV !== 'boolean') {
      return jsonError('Invalid updateKV format', 400);
    }

    if (body.updateKV === true) {
      updateKV = true;
    }

    // Revalidate paths
    const revalidatedPaths: string[] = [];
    for (const path of paths) {
      try {
        revalidatePath(path);
        revalidatedPaths.push(path);
        console.log('[revalidate] Revalidated path', { path });
      } catch (error) {
        console.error('[revalidate] Failed to revalidate path', { path, error });
      }
    }

    // Revalidate tags
    const revalidatedTags: string[] = [];
    for (const tag of tags) {
      try {
        revalidateTag(tag, { expire: 0 });
        revalidatedTags.push(tag);
        console.log('[revalidate] Revalidated tag', { tag });
      } catch (error) {
        console.error('[revalidate] Failed to revalidate tag', { tag, error });
      }
    }

    // Phase 5b: Update KV cache if requested
    let kvUpdated = false;
    let kvUpdateDetails: { ja: boolean; en: boolean; ko: boolean; metadata: boolean } | null = null;
    let kvError: string | null = null;

    if (updateKV) {
      try {
        console.log('[revalidate] Updating KV cache...');
        const { getAkyoDataFromJSON, getAkyoDataFromJSONIfExists } =
          await import('@/lib/akyo-data-json');
        const { updateKVCacheAll } = await import('@/lib/akyo-data-kv');

        // Fetch fresh data from JSON for all languages (ko is optional)
        const [dataJa, dataEn, dataKo] = await Promise.all([
          getAkyoDataFromJSON('ja'),
          getAkyoDataFromJSON('en'),
          getAkyoDataFromJSONIfExists('ko'),
        ]);

        if (!dataKo) {
          console.warn('[revalidate] Korean JSON data not available on CDN, skipping ko KV update');
        }

        // Update all languages in one batch with unified metadata update
        kvUpdateDetails = await updateKVCacheAll(dataJa, dataEn, dataKo ?? undefined);
        // ko is non-fatal only when Korean JSON was unavailable (dataKo is null).
        // If Korean data was fetched but the KV write failed, treat as fatal.
        const koRequired = dataKo !== null;
        kvUpdated =
          kvUpdateDetails.ja &&
          kvUpdateDetails.en &&
          kvUpdateDetails.metadata &&
          (!koRequired || kvUpdateDetails.ko);

        if (!kvUpdated) {
          kvError = `KV update incomplete: ja=${kvUpdateDetails.ja}, en=${kvUpdateDetails.en}, ko=${kvUpdateDetails.ko}, meta=${kvUpdateDetails.metadata}`;
          console.error(`[revalidate] ${kvError}`);
        } else if (!kvUpdateDetails.ko) {
          // ko JSON was unavailable — log as warning, not error
          console.warn(
            `[revalidate] KV cache update partial: ja=${kvUpdateDetails.ja}, en=${kvUpdateDetails.en}, ko=${kvUpdateDetails.ko} (ko JSON unavailable), meta=${kvUpdateDetails.metadata}`
          );
        } else {
          console.log(
            `[revalidate] KV cache update successful: ja=${kvUpdateDetails.ja}, en=${kvUpdateDetails.en}, ko=${kvUpdateDetails.ko}, meta=${kvUpdateDetails.metadata}`
          );
        }
      } catch (error) {
        kvError = `KV update failed: ${error}`;
        console.error('[revalidate] Failed to update KV cache:', error);
      }
    }

    const result = {
      revalidated: true,
      timestamp: new Date().toISOString(),
      paths: revalidatedPaths,
      tags: revalidatedTags,
      kvUpdated,
      kvUpdateDetails,
      kvError,
    };

    console.log('[revalidate] Revalidation complete:', result);

    // If updateKV was requested but failed, return 500 to signal data inconsistency
    // This ensures calling workflows (e.g., GitHub Actions) detect the failure
    // and can retry or alert, preventing stale KV data from being served
    if (updateKV && !kvUpdated) {
      return jsonError('KV cache update failed', 500, result);
    }

    return jsonSuccess(result);
  } catch (error) {
    console.error('[revalidate] Unexpected error:', error);
    return jsonError('Internal server error', 500);
  }
}

// Health check endpoint
export async function GET(): Promise<Response> {
  await connection();
  return jsonSuccess({
    status: 'ok',
    endpoint: '/api/revalidate',
    method: 'POST',
    description: 'On-demand ISR revalidation endpoint',
  });
}
