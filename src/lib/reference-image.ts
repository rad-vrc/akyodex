import {
  getReferenceDerivativeKey,
  REFERENCE_SERIAL_PATTERN,
  REFERENCE_VARIANTS,
} from "./reference-image-contract";

export type ReferenceImageStage =
  | "preview"
  | "zoom"
  | "original"
  | "card"
  | "unavailable";

export interface ReferenceImageUrls {
  card: string;
  original: string;
  preview: string | null;
  zoom: string | null;
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
  const canUseDerivatives = REFERENCE_SERIAL_PATTERN.test(serial);
  const derivativeUrl = (width: (typeof REFERENCE_VARIANTS)[number]["width"]) =>
    `${normalizedReferenceBase}/${getReferenceDerivativeKey(serial, width).slice("reference/".length)}`;
  return {
    card: cardUrl,
    original: `${normalizedOriginalBase}/${serial}.png`,
    preview: canUseDerivatives ? derivativeUrl(REFERENCE_VARIANTS[0].width) : null,
    zoom: canUseDerivatives ? derivativeUrl(REFERENCE_VARIANTS[1].width) : null,
  };
}

export function getInitialReferenceImageStage(urls: ReferenceImageUrls): ReferenceImageStage {
  return urls.preview ? "preview" : "original";
}

export function getReferenceImageIdentity({ id, entryType, serial, cardUrl, urls }: {
  id: string;
  entryType: string;
  serial: string;
  cardUrl: string;
  urls: ReferenceImageUrls | null;
}): string {
  return JSON.stringify([id, entryType, serial, cardUrl, urls?.original, urls?.preview, urls?.zoom, urls?.card]);
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
