// Shared by the generator, offline maintenance, and browser URL selection.
export const REFERENCE_SERIAL_PATTERN = /^\d{4}$/;
export const REFERENCE_SOURCE_KEY_PATTERN = /^(\d{4})\.png$/;
export const REFERENCE_DERIVATIVE_KEY_PATTERN = /^reference\/(\d{4})-(960|1920)\.webp$/;
export const REFERENCE_GENERATOR_VERSION = "v1";
export const REFERENCE_QUALITY = 82;
export const REFERENCE_IMAGE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
export const REFERENCE_VARIANTS = [
  { kind: "preview", width: 960, maxBytes: 250_000 },
  { kind: "zoom", width: 1920, maxBytes: 600_000 },
] as const;

export type ReferenceImageWidth = (typeof REFERENCE_VARIANTS)[number]["width"];

export function getReferenceDerivativeKey(serial: string, width: ReferenceImageWidth): string {
  return `reference/${serial}-${width}.webp`;
}
