import { getPreferredImageFormat } from './accept-image-format';

const DEFAULT_VRCHAT_IMAGE_WIDTH = 512;
const MIN_VRCHAT_IMAGE_WIDTH = 32;
const MAX_VRCHAT_IMAGE_WIDTH = 4096;
const ALLOWED_VRCHAT_IMAGE_WIDTHS = [96, 384, 512, 800, 1024] as const;
const VRCHAT_IMAGE_FETCH_TIMEOUT_MS = 30000;
const VRCHAT_IMAGE_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000';
const ALLOWED_IMAGE_HOSTS = new Set([
  'api.vrchat.cloud',
  'files.vrchat.cloud',
  'images.vrchat.cloud',
  'vrchat.com',
]);

export type CloudflareImageFormat = 'avif' | 'webp';

interface VRChatWorldImageFetchResult {
  response: Response;
  transformed: boolean;
}

function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetaContent(html: string, name: string): string {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const contentMatch = tag.match(/\bcontent=(["'])(.*?)\1/i);
    if (!contentMatch?.[2]) {
      continue;
    }

    if (new RegExp(`\\b(?:name|property)=(["'])${escapeRegExp(name)}\\1`, 'i').test(tag)) {
      return contentMatch[2];
    }
  }

  return '';
}

export function normalizeVRChatImageWidth(value: string | number | null | undefined): number {
  const parsedWidth =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsedWidth)) {
    return DEFAULT_VRCHAT_IMAGE_WIDTH;
  }

  return Math.max(MIN_VRCHAT_IMAGE_WIDTH, Math.min(MAX_VRCHAT_IMAGE_WIDTH, parsedWidth));
}

export function snapVRChatImageWidth(
  value: string | number | null | undefined
): number {
  const normalizedWidth = normalizeVRChatImageWidth(value);
  return ALLOWED_VRCHAT_IMAGE_WIDTHS.reduce((closest, candidate) =>
    Math.abs(candidate - normalizedWidth) < Math.abs(closest - normalizedWidth)
      ? candidate
      : closest
  );
}

export function getPreferredCloudflareImageFormat(
  accept: string | null
): CloudflareImageFormat | null {
  return getPreferredImageFormat(accept);
}

export function createVRChatWorldImageFetchInit(args: {
  width: number;
  format: CloudflareImageFormat | null;
  signal: AbortSignal;
}): RequestInit {
  const { width, format, signal } = args;
  const init: RequestInit = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: format
        ? `image/${format},image/webp,image/png,image/*,*/*`
        : 'image/png,image/*,*/*',
    },
    signal,
    next: { revalidate: 3600 },
  };

  if (format) {
    init.cf = {
      image: {
        width: snapVRChatImageWidth(width),
        fit: 'scale-down',
        quality: 80,
        format,
      },
    };
  }

  return init;
}

function isConfirmedCloudflareImageTransform(
  response: Response,
  format: CloudflareImageFormat
): boolean {
  const resizedHeader = response.headers.get('Cf-Resized');
  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();

  return Boolean(
    resizedHeader &&
      !/\berr=\d+/i.test(resizedHeader) &&
      contentType === `image/${format}`
  );
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A locked or already-consumed body does not prevent the original-image retry.
  }
}

async function fetchVRChatWorldImageAttempt(args: {
  imageUrl: string;
  width: number;
  format: CloudflareImageFormat | null;
  fetchFn: typeof fetch;
  timeoutMs: number;
}): Promise<Response> {
  const { imageUrl, width, format, fetchFn, timeoutMs } = args;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(
      imageUrl,
      createVRChatWorldImageFetchInit({
        width,
        format,
        signal: controller.signal,
      })
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchVRChatWorldImageWithFallback(args: {
  imageUrl: string;
  width: number;
  format: CloudflareImageFormat | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<VRChatWorldImageFetchResult> {
  const {
    imageUrl,
    width,
    format,
    fetchFn = fetch,
    timeoutMs = VRCHAT_IMAGE_FETCH_TIMEOUT_MS,
  } = args;
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remainingTimeout = () => Math.max(1, deadline - Date.now());

  if (format) {
    try {
      const transformedResponse = await fetchVRChatWorldImageAttempt({
        imageUrl,
        width,
        format,
        fetchFn,
        timeoutMs: remainingTimeout(),
      });
      if (
        transformedResponse.ok &&
        isConfirmedCloudflareImageTransform(transformedResponse, format)
      ) {
        return { response: transformedResponse, transformed: true };
      }
      await discardResponseBody(transformedResponse);
    } catch {
      // Retry once without Images Transformations below.
    }
  }

  const response = await fetchVRChatWorldImageAttempt({
    imageUrl,
    width,
    format: null,
    fetchFn,
    timeoutMs: remainingTimeout(),
  });
  return { response, transformed: false };
}

export function getVRChatWorldImageResponseHeaders(contentType: string): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Cache-Control': VRCHAT_IMAGE_CACHE_CONTROL,
    Vary: 'Accept',
    'X-Image-Source': 'vrchat-world-ogp',
  });
}

export function getSizedVRChatWorldImageUrl(imageUrl: string, width: number): string {
  const normalizedWidth = normalizeVRChatImageWidth(width);

  const apiImageMatch = imageUrl.match(
    /^https?:\/\/api\.vrchat\.cloud\/api\/1\/image\/(file_[A-Za-z0-9-]+)\/(\d+)\/\d+$/i
  );
  if (apiImageMatch?.[1] && apiImageMatch?.[2]) {
    return `https://api.vrchat.cloud/api/1/image/${apiImageMatch[1]}/${apiImageMatch[2]}/${normalizedWidth}`;
  }

  const apiFileMatch = imageUrl.match(
    /^https?:\/\/api\.vrchat\.cloud\/api\/1\/file\/(file_[A-Za-z0-9-]+)\/(\d+)\/file$/i
  );
  if (apiFileMatch?.[1] && apiFileMatch?.[2]) {
    return `https://api.vrchat.cloud/api/1/image/${apiFileMatch[1]}/${apiFileMatch[2]}/${normalizedWidth}`;
  }

  const filesThumbnailMatch = imageUrl.match(
    /^https?:\/\/files\.vrchat\.cloud\/thumbnails\/(file_[A-Za-z0-9-]+)\/(file_[A-Za-z0-9-]+)\.(\d+)\.thumbnail-\d+\.[A-Za-z]+$/i
  );
  if (filesThumbnailMatch?.[1] && filesThumbnailMatch?.[3]) {
    return `https://api.vrchat.cloud/api/1/image/${filesThumbnailMatch[1]}/${filesThumbnailMatch[3]}/${normalizedWidth}`;
  }

  return imageUrl;
}

export function getVRChatWorldImageRequestParams(requestUrl: string): {
  wrld: string | null;
  width: number;
} {
  const { searchParams } = new URL(requestUrl);
  return {
    wrld: searchParams.get('wrld'),
    width: snapVRChatImageWidth(searchParams.get('w')),
  };
}

export function resolveVRChatWorldImageUrlFromHtml(html: string, width: number): string {
  const ogImage = extractMetaContent(html, 'og:image');
  if (!ogImage) {
    return '';
  }

  const candidate = ogImage.startsWith('/') ? `https://vrchat.com${ogImage}` : ogImage;
  const sizedCandidate = getSizedVRChatWorldImageUrl(candidate, width);
  if (isAllowedImageUrl(sizedCandidate)) {
    return sizedCandidate;
  }

  return isAllowedImageUrl(candidate) ? candidate : '';
}
