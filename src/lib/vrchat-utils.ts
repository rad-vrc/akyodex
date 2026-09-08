import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  detectVrcEntryTypeFromUrl,
  extractVRChatAvatarIdFromUrl,
  extractVRChatWorldIdFromUrl,
  isValidVRChatEntityId,
} from './akyo-entry';

/**
 * VRChat Utilities
 * Helper functions for VRChat entity operations
 */

/**
 * VRChat へ出すときに名乗る User-Agent。
 *
 * VRChat の Creator Guidelines は「Applications must identify themselves properly
 * using the User-Agent request header」と書き、形式を
 * `applicationName/Version contactInfo` と定めている
 * （https://hello.vrchat.com/creator-guidelines）。
 * この要求は文面上 API 利用者向けで、公開ページの取得に及ぶかは明記がないが、
 * どちらの読み方でもブラウザを騙るのは「properly identify」の逆なので名乗る。
 *
 * 以前はここが `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36` で、
 * Chrome のふりをしていた。
 */
export const VRCHAT_USER_AGENT = 'akyodex/1.0 (+https://akyodex.com)';

/**
 * Fetch VRChat entity page with security validation and timeout
 * @param entryType - The VRChat entity type
 * @param id - The VRChat ID (e.g., avtr_xxx / wrld_xxx)
 * @returns The HTML content of the entity page
 * @throws Error if the request fails or times out
 */
export async function fetchVRChatEntityPage(
  entryType: 'avatar' | 'world',
  id: string
): Promise<string> {
  const trimmedId = id.trim();
  if (!isValidVRChatEntityId(entryType, trimmedId)) {
    throw new Error('Invalid VRChat entity ID');
  }

  // Security: construct the request from fixed host + fixed path prefixes only.
  const parsedUrl = new URL('https://vrchat.com');
  parsedUrl.pathname =
    entryType === 'avatar'
      ? `/home/avatar/${encodeURIComponent(trimmedId)}`
      : `/home/world/${encodeURIComponent(trimmedId)}`;

  if (parsedUrl.hostname !== 'vrchat.com' || parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid domain');
  }

  // Create AbortController for 30-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const pageResponse = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': VRCHAT_USER_AGENT,
        'Accept': 'text/html',
      },
      signal: controller.signal,
      next: { revalidate: 21600 }, // Cache for 6 hours
    } as RequestInit);

    clearTimeout(timeoutId);

    if (!pageResponse.ok) {
      throw new Error(`VRChat page returned ${pageResponse.status}`);
    }

    return await pageResponse.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout (30 seconds)');
    }
    throw error;
  }
}

/**
 * Fetch VRChat avatar page with security validation and timeout
 * @param avtr - The VRChat avatar ID (e.g., avtr_xxx)
 * @returns The HTML content of the avatar page
 * @throws Error if the request fails or times out
 */
export async function fetchVRChatPage(avtr: string): Promise<string> {
  return fetchVRChatEntityPage('avatar', avtr);
}

/**
 * Fetch VRChat world page with security validation and timeout.
 * Delegates to {@link fetchVRChatEntityPage} with the `world` entry type.
 *
 * @param wrld - The VRChat world ID or slug (e.g., wrld_xxx)
 * @returns A promise that resolves to the HTML content of the world page
 * @throws Error if the world ID is invalid, the request fails, or the request times out
 */
export async function fetchVRChatWorldPage(wrld: string): Promise<string> {
  return fetchVRChatEntityPage('world', wrld);
}

/**
 * Extract VRChat avatar ID (avtr_xxx) from avatar URL
 * @param avatarUrl - The VRChat avatar URL (e.g., https://vrchat.com/home/avatar/avtr_xxx)
 * @returns The avatar ID (e.g., avtr_xxx) or null if not found
 */
export function extractVRChatAvatarId(avatarUrl: string | undefined): string | null {
  return extractVRChatAvatarIdFromUrl(avatarUrl);
}

/**
 * Extract VRChat world ID (wrld_xxx) from world URL.
 * Delegates to {@link extractVRChatWorldIdFromUrl}.
 *
 * @param worldUrl - The VRChat world URL (e.g., https://vrchat.com/home/world/wrld_xxx)
 * @returns The world ID (e.g., wrld_xxx), or null for undefined / invalid URLs
 *
 * @example
 * extractVRChatWorldId('https://vrchat.com/home/world/wrld_xxx') // 'wrld_xxx'
 * extractVRChatWorldId(undefined) // null
 */
export function extractVRChatWorldId(worldUrl: string | undefined): string | null {
  return extractVRChatWorldIdFromUrl(worldUrl);
}

/**
 * Validates and opens a VRChat URL safely in a new tab.
 * Reconstructs a canonical avatar/world URL when a valid entity ID is present,
 * and otherwise falls back to a strictly validated vrchat.com URL only.
 *
 * @param e - React or Native click event to stop propagation
 * @param url - The source URL to validate
 */
export function safeOpenVRChatLink(e: ReactMouseEvent | MouseEvent, url: string | undefined): void {
  e.stopPropagation();

  if (!url) return;

  const entryType = detectVrcEntryTypeFromUrl(url);

  if (entryType === 'avatar') {
    const avtrId = extractVRChatAvatarId(url);
    if (avtrId) {
      const canonicalUrl = `https://vrchat.com/home/avatar/${encodeURIComponent(avtrId)}`;
      window.open(canonicalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  if (entryType === 'world') {
    const wrldId = extractVRChatWorldId(url);
    if (wrldId) {
      const canonicalUrl = `https://vrchat.com/home/world/${encodeURIComponent(wrldId)}`;
      window.open(canonicalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  // Fallback: Strict domain validation if no canonical entity URL can be reconstructed
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname === 'vrchat.com') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      console.warn('[vrchat-utils] Blocked non-VRChat URL:', url);
    }
  } catch {
    console.warn('[vrchat-utils] Invalid URL format:', url);
  }
}

/**
 * Build the catalog image URL using the source VRChat URL.
 * When a world ID is present, this returns the world image proxy endpoint.
 * When an avatar ID is present, this returns the avatar image proxy endpoint.
 * Otherwise, it falls back to the default avatar image endpoint by Akyo ID only.
 *
 * @param id - The Akyo ID
 * @param sourceUrl - The source VRChat URL (avatar/world)
 * @param width - The desired image width (default: 512)
 * @returns The constructed image URL for world, avatar, or default fallback cases
 */
export function buildAvatarImageUrl(
  id: string,
  sourceUrl: string | undefined,
  width: number = 512
): string {
  const wrldId = extractVRChatWorldId(sourceUrl);
  if (wrldId) {
    return `/api/vrc-world-image?wrld=${wrldId}&w=${width}`;
  }

  const avtrId = extractVRChatAvatarId(sourceUrl);

  if (avtrId) {
    return `/api/avatar-image?id=${id}&avtr=${avtrId}&w=${width}`;
  }

  return `/api/avatar-image?id=${id}&w=${width}`;
}
