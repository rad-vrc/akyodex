export type ReferenceImageStage =
  | "preview"
  | "zoom"
  | "original"
  | "card"
  | "unavailable";

export interface ReferenceImageUrls {
  card: string;
  original: string;
  preview: string;
  zoom: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getReferenceImageUrls({
  cardUrl,
  originalBaseUrl,
  referenceBaseUrl,
  serial,
}: {
  cardUrl: string;
  originalBaseUrl: string;
  referenceBaseUrl: string;
  serial: string;
}): ReferenceImageUrls {
  const normalizedOriginalBase = trimTrailingSlash(originalBaseUrl);
  const normalizedReferenceBase = trimTrailingSlash(referenceBaseUrl);
  return {
    card: cardUrl,
    original: `${normalizedOriginalBase}/${serial}.png`,
    preview: `${normalizedReferenceBase}/${serial}-960.webp`,
    zoom: `${normalizedReferenceBase}/${serial}-1920.webp`,
  };
}

export function getNextReferenceImageStage(
  current: ReferenceImageStage,
): ReferenceImageStage {
  switch (current) {
    case "preview":
      return "zoom";
    case "zoom":
      return "original";
    case "original":
      return "card";
    case "card":
    case "unavailable":
      return "unavailable";
  }
}

export function resolveReferenceImageUrl(
  stage: ReferenceImageStage,
  urls: ReferenceImageUrls,
): string | null {
  return stage === "unavailable" ? null : urls[stage];
}
