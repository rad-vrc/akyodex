import localFont from "next/font/local";

/**
 * Self-hosted M PLUS 2 (variable, wght axis intact), subset to the catalog's
 * real character inventory (see scripts/generate-font-subsets.mjs). Exposed
 * through the long-standing `--font-m-plus-rounded` variable so the existing
 * body font stack in globals.css picks it up without selector changes.
 *
 * M PLUS Rounded 1cから差し替え: 旧書体はRegular〜Mediumの線が細く、等倍の
 * 小サイズ本文でストロークがかすれて見えた（ドット欠け）。2021年新設計の
 * M PLUS 2は細ウェイトでも痩せない字形で、この症状が出ない。可変1ファイル
 * なので400/500/600/700/800/900すべて実ウェイト、合計サイズも旧3ファイル
 * (586KB)より軽い338KB。
 *
 * Characters outside the subset (Korean text, brand-new kanji before the
 * next data sync) fall back to the system stack below — no tofu.
 */
export const mPlus2 = localFont({
  src: [
    {
      path: "../fonts/mplus2-variable.subset.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-m-plus-rounded",
  fallback: ["Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", "sans-serif"],
  adjustFontFallback: false,
  // preloadすると大きめのフォントがLCP画像と帯域を取り合い、Lighthouse(Lantern)の
  // LCP中央値が6.4s→9.5sへ悪化した（LHCI予算超過）。和文グリフは新旧とも全角等幅で
  // スワップ時のリフローがほぼ無い（実測CLS≦0.005）ため、クリティカルパス外で
  // 遅延ロードし display:swap で差し替える。
  preload: false,
});
