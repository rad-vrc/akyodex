export function resolveCropSourceImage(
  latestLoadedImageSrc: string | null,
  previewImageSrc: string | null,
): string | null {
  return latestLoadedImageSrc ?? previewImageSrc;
}
