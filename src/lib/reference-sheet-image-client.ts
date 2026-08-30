import { buildAvatarImageUrl } from "./vrchat-utils";

export type DetailImageStage =
  | "reference-optimized"
  | "reference-original"
  | "card"
  | "failed";

export interface DetailImageState {
  stage: DetailImageStage;
  url: string | null;
}

export interface DetailImageArgs {
  entryType: "avatar" | "world" | "booth";
  id: string;
  displaySerial: string;
  sourceUrl: string | undefined;
  r2BaseUrl: string;
}

export function createInitialDetailImageState(
  args: DetailImageArgs,
): DetailImageState {
  if (args.entryType === "world") {
    return {
      stage: "card",
      url: buildAvatarImageUrl(args.id, args.sourceUrl, 800),
    };
  }

  return {
    stage: "reference-optimized",
    url: `/api/reference-image?id=${encodeURIComponent(args.displaySerial)}`,
  };
}

export function getNextDetailImageState(
  current: DetailImageState,
  args: DetailImageArgs,
): DetailImageState {
  if (current.stage === "reference-optimized") {
    const normalizedBaseUrl = args.r2BaseUrl.endsWith("/")
      ? args.r2BaseUrl
      : `${args.r2BaseUrl}/`;
    return {
      stage: "reference-original",
      url: new URL(`${args.displaySerial}.png`, normalizedBaseUrl).toString(),
    };
  }

  if (current.stage === "reference-original") {
    return {
      stage: "card",
      url: buildAvatarImageUrl(args.id, args.sourceUrl, 800),
    };
  }

  return { stage: "failed", url: null };
}
