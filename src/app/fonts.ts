import localFont from "next/font/local";

/**
 * Self-hosted M PLUS Rounded 1c, subset to the catalog's real character
 * inventory (see scripts/generate-font-subsets.mjs). Exposed through the
 * long-standing `--font-m-plus-rounded` variable so the existing body
 * font stack in globals.css picks it up without selector changes.
 *
 * Characters outside the subset (Korean text, brand-new kanji before the
 * next data sync) fall back to the system stack below — no tofu.
 */
export const mPlusRounded1c = localFont({
  src: [
    {
      path: "../fonts/mplus-rounded-1c-regular.subset.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/mplus-rounded-1c-bold.subset.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../fonts/mplus-rounded-1c-black.subset.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-m-plus-rounded",
  fallback: ["Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", "sans-serif"],
  adjustFontFallback: false,
  preload: true,
});
