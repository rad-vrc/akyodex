import { getPreferredImageFormat } from "./accept-image-format";

const AVATAR_CARD_IMAGE_WIDTH = 768;
const AVATAR_CARD_IMAGE_FETCH_TIMEOUT_MS = 5000;
const AVATAR_CARD_IMAGE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

export type AvatarCardImageFormat = "avif" | "webp";
export type AvatarImageFailureKind = "not-found" | "upstream-error";

interface AvatarCardImageFetchResult {
  response: Response;
  transformed: boolean;
}

export function shouldTransformAvatarCardImage(args: {
  width: number;
  bypassCloudflare: boolean;
}): boolean {
  return args.width === AVATAR_CARD_IMAGE_WIDTH && !args.bypassCloudflare;
}

export function getPreferredAvatarCardImageFormat(
  accept: string | null,
): AvatarCardImageFormat | null {
  return getPreferredImageFormat(accept);
}

export function createAvatarCardImageFetchInit(args: {
  format: AvatarCardImageFormat | null;
  signal: AbortSignal;
}): RequestInit {
  const init: RequestInit = {
    headers: {
      Accept: args.format
        ? `image/${args.format},image/webp,image/png,image/*,*/*`
        : "image/webp,image/png,image/*,*/*",
    },
    signal: args.signal,
    next: { revalidate: 3600 },
  };

  if (args.format) {
    init.cf = {
      image: {
        width: AVATAR_CARD_IMAGE_WIDTH,
        fit: "scale-down",
        quality: 80,
        format: args.format,
      },
    };
  }

  return init;
}

function isConfirmedCloudflareImageTransform(
  response: Response,
  format: AvatarCardImageFormat,
): boolean {
  const resizedHeader = response.headers.get("Cf-Resized");
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  return Boolean(
    resizedHeader &&
      !/\berr=\d+/i.test(resizedHeader) &&
      contentType === `image/${format}`,
  );
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A locked or consumed body does not prevent the original-image retry.
  }
}

async function fetchAvatarCardImageAttempt(args: {
  imageUrl: string;
  format: AvatarCardImageFormat | null;
  fetchFn: typeof fetch;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    return await args.fetchFn(
      args.imageUrl,
      createAvatarCardImageFetchInit({
        format: args.format,
        signal: controller.signal,
      }),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchAvatarCardImageWithFallback(args: {
  imageUrl: string;
  format: AvatarCardImageFormat | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<AvatarCardImageFetchResult> {
  const {
    imageUrl,
    format,
    fetchFn = fetch,
    timeoutMs = AVATAR_CARD_IMAGE_FETCH_TIMEOUT_MS,
  } = args;
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remainingTimeout = () => Math.max(1, deadline - Date.now());

  if (format) {
    try {
      const transformedResponse = await fetchAvatarCardImageAttempt({
        imageUrl,
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
      // Retry the original R2 object within the same deadline below.
    }
  }

  const response = await fetchAvatarCardImageAttempt({
    imageUrl,
    format: null,
    fetchFn,
    timeoutMs: remainingTimeout(),
  });
  return { response, transformed: false };
}

export function getAvatarCardImageResponseHeaders(
  contentType: string,
  transformed: boolean,
): Headers {
  // A future CDN Cache Rule must normalize Accept into the cache key. Caching
  // this negotiated URL without that rule can serve AVIF to unsupported clients.
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": AVATAR_CARD_IMAGE_CACHE_CONTROL,
    Vary: "Accept",
    "X-Image-Source": "r2",
    "X-Image-Transformed": String(transformed),
  });
}

export function createAvatarImageFailureResponse(
  failureKind: AvatarImageFailureKind,
): Response {
  const upstreamFailure = failureKind === "upstream-error";

  return Response.json(
    {
      success: false,
      error: upstreamFailure
        ? "Avatar image upstream request failed"
        : "Avatar image not found",
    },
    {
      status: upstreamFailure ? 502 : 404,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
