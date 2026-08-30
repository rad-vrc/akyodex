import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readUtf8(relativePath: string) {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

test("root metadata explicitly references optimized social preview images", () => {
  const layoutSource = readUtf8("app/layout.tsx");

  assert.match(layoutSource, /images:\s*\[\{\s*url:\s*['"]\/opengraph-image\.png['"]/);
  assert.match(layoutSource, /images:\s*\[['"]\/twitter-image\.png['"]\]/);
});

test("zukan metadata explicitly references optimized social preview images", () => {
  const zukanPageSource = readUtf8("app/zukan/page.tsx");

  assert.match(zukanPageSource, /images:\s*\[\{\s*url:\s*['"]\/opengraph-image\.png['"]/);
  assert.match(zukanPageSource, /images:\s*\[['"]\/twitter-image\.png['"]\]/);
});

test("static social image files exist and stay within provider limits", () => {
  const opengraphImage = join(projectRoot, "app/opengraph-image.png");
  const twitterImage = join(projectRoot, "app/twitter-image.png");

  assert.equal(existsSync(opengraphImage), true);
  assert.equal(existsSync(twitterImage), true);
  assert.ok(statSync(opengraphImage).size < 8 * 1024 * 1024);
  assert.ok(statSync(twitterImage).size < 5 * 1024 * 1024);
});
