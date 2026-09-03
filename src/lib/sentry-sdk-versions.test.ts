import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * ブラウザ側は @sentry/react で初期化し、性能計測だけ @sentry/nextjs から後付けする構成のため、
 * 2 つのパッケージが同じ SDK 版（= 同じ @sentry/core の実体）に解決されていないと、
 * 後付けした integration が初期化済みクライアントを見つけられない。
 * Dependabot などで片方だけ上げると壊れるので、lockfile の解決結果で固定する。
 */
test("@sentry/react と @sentry/nextjs は同じ版に解決され、@sentry のパッケージは二重に入っていない", () => {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };

  assert.ok(pkg.dependencies["@sentry/react"], "@sentry/react を直接依存に持つ");
  assert.ok(pkg.dependencies["@sentry/nextjs"], "@sentry/nextjs を直接依存に持つ");

  const reactVersion = lock.packages["node_modules/@sentry/react"]?.version;
  const nextjsVersion = lock.packages["node_modules/@sentry/nextjs"]?.version;
  assert.ok(reactVersion && nextjsVersion, "lockfile に両方の解決結果がある");
  assert.equal(reactVersion, nextjsVersion, "@sentry/react と @sentry/nextjs の版が一致する");

  // どこかのパッケージ配下に別版の @sentry/* が nest していない（単一の core を共有する）。
  // @sentry/cli などが自分の依存（glob, which …）を nest させるのは対象外なので、
  // 末尾のセグメントが @sentry/<name> のものだけを見る
  const nested = Object.keys(lock.packages).filter((key) => {
    const segments = key.split("node_modules/");
    const last = segments[segments.length - 1] ?? "";
    return segments.length > 2 && last.startsWith("@sentry/");
  });
  assert.deepEqual(nested, [], "nest した @sentry パッケージがある: " + nested.join(", "));
});
