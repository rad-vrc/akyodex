export type ReferenceSheetImageFailureStage =
  | "validation"
  | "source-head"
  | "source-metadata"
  | "transform"
  | "timeout";

export interface ReferenceSheetImageResult {
  response: Response;
  failureStage?: ReferenceSheetImageFailureStage;
}

const REFERENCE_IMAGE_WIDTH = 1920;
const REFERENCE_IMAGE_QUALITY = 82;
const REFERENCE_IMAGE_FORMAT = "webp";
const REFERENCE_IMAGE_TIMEOUT_MS = 5000;
const REFERENCE_IMAGE_CACHE_CONTROL =
  "public, max-age=0, must-revalidate";

export function isReferenceSheetId(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export function createReferenceSheetImageFetchInit(
  signal: AbortSignal,
): RequestInit {
  return {
    method: "GET",
    headers: { Accept: "image/webp" },
    signal,
    cf: {
      image: {
        width: REFERENCE_IMAGE_WIDTH,
        fit: "scale-down",
        quality: REFERENCE_IMAGE_QUALITY,
        format: REFERENCE_IMAGE_FORMAT,
      },
    },
  };
}

function getSourceEtagToken(sourceEtag: string): string | null {
  let token = sourceEtag.trim();
  if (/^W\//i.test(token)) {
    token = token.slice(2).trim();
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    token = token.slice(1, -1);
  }
  return token || null;
}

export function getReferenceSheetResponseEtag(sourceEtag: string): string {
  const sourceToken = getSourceEtagToken(sourceEtag);
  if (!sourceToken) {
    throw new Error("Reference sheet source ETag is empty");
  }

  return `W/"reference-${REFERENCE_IMAGE_WIDTH}-q${REFERENCE_IMAGE_QUALITY}-${REFERENCE_IMAGE_FORMAT}-${encodeURIComponent(sourceToken)}"`;
}

function normalizeWeakEtag(etag: string): string {
  return etag.trim().replace(/^W\//i, "");
}

function etagMatches(ifNoneMatch: string | null, responseEtag: string): boolean {
  if (!ifNoneMatch) return false;

  const normalizedResponseEtag = normalizeWeakEtag(responseEtag);
  return ifNoneMatch.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || normalizeWeakEtag(trimmed) === normalizedResponseEtag;
  });
}

function createSuccessHeaders(etag: string): Headers {
  return new Headers({
    "Cache-Control": REFERENCE_IMAGE_CACHE_CONTROL,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Image-Source": "r2-reference-sheet",
    "X-Image-Transformed": "true",
  });
}

function createFailureResult(
  status: number,
  message: string,
  failureStage: ReferenceSheetImageFailureStage,
): ReferenceSheetImageResult {
  return {
    response: Response.json(
      { success: false, error: message },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    ),
    failureStage,
  };
}

function isConfirmedReferenceImageTransform(response: Response): boolean {
  const resizedHeader = response.headers.get("Cf-Resized");
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  return Boolean(
    response.ok &&
      resizedHeader &&
      !/\berr=\d+/i.test(resizedHeader) &&
      contentType === "image/webp",
  );
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A locked body does not change the failure response returned to the client.
  }
}

function createSourceUrl(r2BaseUrl: string, id: string): URL {
  const normalizedBaseUrl = r2BaseUrl.endsWith("/")
    ? r2BaseUrl
    : `${r2BaseUrl}/`;
  return new URL(`${id}.png`, normalizedBaseUrl);
}

export async function fetchReferenceSheetImage(args: {
  id: string;
  ifNoneMatch: string | null;
  r2BaseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReferenceSheetImageResult> {
  const {
    id,
    ifNoneMatch,
    r2BaseUrl,
    fetchFn = fetch,
    timeoutMs = REFERENCE_IMAGE_TIMEOUT_MS,
  } = args;

  if (!isReferenceSheetId(id)) {
    return createFailureResult(400, "Invalid reference sheet ID", "validation");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Math.max(1, timeoutMs),
  );

  try {
    const sourceUrl = createSourceUrl(r2BaseUrl, id);
    const sourceResponse = await fetchFn(sourceUrl, {
      method: "HEAD",
      headers: { Accept: "image/png" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!sourceResponse.ok) {
      return sourceResponse.status === 404
        ? createFailureResult(404, "Reference sheet not found", "source-head")
        : createFailureResult(
            502,
            "Reference sheet source request failed",
            "source-head",
          );
    }

    const sourceEtag = sourceResponse.headers.get("ETag");
    const sourceToken = sourceEtag ? getSourceEtagToken(sourceEtag) : null;
    if (!sourceEtag || !sourceToken) {
      return createFailureResult(
        502,
        "Reference sheet source ETag is unavailable",
        "source-metadata",
      );
    }

    const responseEtag = getReferenceSheetResponseEtag(sourceEtag);
    const successHeaders = createSuccessHeaders(responseEtag);
    if (etagMatches(ifNoneMatch, responseEtag)) {
      return {
        response: new Response(null, {
          status: 304,
          headers: successHeaders,
        }),
      };
    }

    sourceUrl.searchParams.set("v", sourceToken);
    const transformedResponse = await fetchFn(
      sourceUrl,
      createReferenceSheetImageFetchInit(controller.signal),
    );
    if (
      !isConfirmedReferenceImageTransform(transformedResponse) ||
      !transformedResponse.body
    ) {
      await discardResponseBody(transformedResponse);
      return createFailureResult(
        502,
        "Reference sheet transformation failed",
        "transform",
      );
    }

    successHeaders.set("Content-Type", "image/webp");
    const contentLength = transformedResponse.headers.get("Content-Length");
    if (contentLength) {
      successHeaders.set("Content-Length", contentLength);
    }

    return {
      response: new Response(transformedResponse.body, {
        status: 200,
        headers: successHeaders,
      }),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return createFailureResult(
        504,
        "Reference sheet request timed out",
        "timeout",
      );
    }

    return createFailureResult(
      502,
      "Reference sheet request failed",
      "source-head",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
