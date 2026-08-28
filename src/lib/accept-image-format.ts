export type PreferredImageFormat = "avif" | "webp";

const FORMAT_PREFERENCE: readonly PreferredImageFormat[] = ["avif", "webp"];

function parseQuality(parameters: readonly string[]): number {
  const qualityParameter = parameters.find((parameter) => {
    const [name] = parameter.split("=", 1);
    return name?.trim().toLowerCase() === "q";
  });

  if (!qualityParameter) return 1;

  const separatorIndex = qualityParameter.indexOf("=");
  const parsedQuality = Number(qualityParameter.slice(separatorIndex + 1).trim());
  return Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
    ? parsedQuality
    : 0;
}

export function getPreferredImageFormat(
  accept: string | null,
): PreferredImageFormat | null {
  if (!accept) return null;

  const qualityByFormat = new Map<PreferredImageFormat, number>();

  for (const mediaRange of accept.split(",")) {
    const [rawMediaType, ...parameters] = mediaRange.split(";");
    const mediaType = rawMediaType?.trim().toLowerCase();
    const format = FORMAT_PREFERENCE.find(
      (candidate) => mediaType === `image/${candidate}`,
    );
    if (!format) continue;

    const quality = parseQuality(parameters);
    qualityByFormat.set(
      format,
      Math.max(qualityByFormat.get(format) ?? 0, quality),
    );
  }

  let preferredFormat: PreferredImageFormat | null = null;
  let preferredQuality = 0;
  for (const format of FORMAT_PREFERENCE) {
    const quality = qualityByFormat.get(format) ?? 0;
    if (quality > preferredQuality) {
      preferredFormat = format;
      preferredQuality = quality;
    }
  }

  return preferredFormat;
}
