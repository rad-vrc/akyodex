import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { VRCHAT_USER_AGENT } from "./vrchat-utils";

/**
 * VRChat の Creator Guidelines は User-Agent での名乗りを求めている。
 * 形式は `applicationName/Version contactInfo`
 * （https://hello.vrchat.com/creator-guidelines）。
 * 以前はブラウザを騙る文字列だったので、戻らないようにここで固定する。
 */
test("the VRChat User-Agent identifies the application, not a browser", () => {
  assert.match(VRCHAT_USER_AGENT, /^akyodex\/\d+\.\d+ /);
  assert.ok(
    /\(\+https:\/\/|@/.test(VRCHAT_USER_AGENT),
    `連絡先（URL かメール）が必要: ${VRCHAT_USER_AGENT}`,
  );
  for (const browserish of ["Mozilla", "AppleWebKit", "Chrome", "Safari", "Gecko"]) {
    assert.ok(
      !VRCHAT_USER_AGENT.includes(browserish),
      `ブラウザを騙る語が入っている: ${browserish}`,
    );
  }
});

/**
 * 名乗りは 1 か所に集めてある。個別のリクエストで直接ブラウザ名を書くと
 * この定数を通らず元に戻ってしまうので、src 配下に残っていないことを見る。
 */
test("no request in src spoofs a browser User-Agent", async () => {
  const root = path.join(process.cwd(), "src");
  const offenders: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // この検査自身と、経緯を書いた定数のコメントは対象外
      if (full.endsWith("vrchat-user-agent.test.ts")) continue;
      const source = await readFile(full, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (!line.includes("Mozilla/5.0")) continue;
        if (line.trimStart().startsWith("*")) continue; // コメント行
        offenders.push(`${path.relative(root, full)}:${index + 1}`);
      }
    }
  };

  await walk(root);
  assert.deepEqual(offenders, [], `ブラウザを騙る User-Agent が残っている: ${offenders.join(", ")}`);
});
