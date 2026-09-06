import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 通知の枠の色が WCAG 1.4.11（非テキストの 3:1）を満たし続けることを守る。
 *
 * 通知の地とボタンの白地はほとんど同じ明るさなので、部品の形を示しているのは枠だけになる。
 * 以前は Tailwind 既定の amber-400 / amber-300 / sky-300 を使っており、実描画で
 * 1.39〜1.72:1 しか無かった（本番の再試行ボタンで実測）。
 */

const CSS = readFileSync(
  path.join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

/**
 * 枠が乗る地のうち最も暗いもの。通知の地（amber-50 / sky-50 を 95% で重ねたもの）は
 * これより明るいので、暗い枠色にとってはページ地が最悪条件になる。
 * ここを満たせば、より明るい通知の地でもボタンの白地でも自動的に満たす
 */
const DARKEST_BACKDROP = "#fff5e6"; // --bg-gradient-start

function readToken(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `globals.css に --${name} が無い`);
  return match[1]!.toLowerCase();
}

function toRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = toRgb(hex).map((value) => value / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const raw =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

function hueDistance(left: number, right: number): number {
  const diff = Math.abs(left - right) % 360;
  return diff > 180 ? 360 - diff : diff;
}

test("通知の枠はページ地に対して 3:1 以上ある", () => {
  for (const token of ["color-notice-warn", "color-notice-info"]) {
    const color = readToken(token);
    const ratio = contrastRatio(color, DARKEST_BACKDROP);
    assert.ok(
      ratio >= 3,
      `--${token} (${color}) は ${ratio.toFixed(2)}:1 で 3:1 に届かない`,
    );
  }
});

test("通知の枠の色相はサイトのトークンから離れない", () => {
  // amber(44〜49) へ戻すと、サイトのサンゴ色オレンジから外れて黄金色に振れる
  const warn = readToken("color-notice-warn");
  const info = readToken("color-notice-info");
  const primaryOrange = readToken("primary-orange");
  const primaryBlue = readToken("primary-blue");

  assert.ok(
    hueDistance(hue(warn), hue(primaryOrange)) <= 20,
    `--color-notice-warn の色相 ${hue(warn).toFixed(0)} が ` +
      `--primary-orange の ${hue(primaryOrange).toFixed(0)} から離れすぎている`,
  );
  assert.ok(
    hueDistance(hue(info), hue(primaryBlue)) <= 20,
    `--color-notice-info の色相 ${hue(info).toFixed(0)} が ` +
      `--primary-blue の ${hue(primaryBlue).toFixed(0)} から離れすぎている`,
  );
});

test("通知とボタンは Tailwind 既定の薄い枠色に戻っていない", () => {
  const client = readFileSync(
    path.join(process.cwd(), "src", "app", "zukan", "zukan-client.tsx"),
    "utf8",
  );
  for (const faded of ["border-amber-300", "border-amber-400", "border-sky-300"]) {
    assert.ok(
      !client.includes(faded),
      `${faded} は 1.4〜1.7:1 しか無いので通知には使わない`,
    );
  }
});
