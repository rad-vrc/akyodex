import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  generateCatalogSnapshots,
  resolveCatalogSnapshotDirectories,
} from "./generate-catalog-snapshots";

test("resolveCatalogSnapshotDirectories works without import.meta.dirname", () => {
  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "scripts", "generate-catalog-snapshots.ts"),
  ).href;

  assert.deepEqual(resolveCatalogSnapshotDirectories(moduleUrl), {
    sourceDir: path.join(process.cwd(), "data"),
    outputDir: path.join(process.cwd(), "public", "catalog"),
  });
});

test("generateCatalogSnapshots writes versioned complete payloads for every language", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akyodex-catalog-"));
  const sourceDir = path.join(root, "data");
  const outputDir = path.join(root, "public", "catalog");
  await mkdir(sourceDir, { recursive: true });

  try {
    for (const language of ["ja", "en", "ko"] as const) {
      await writeFile(
        path.join(sourceDir, `akyo-data-${language}.json`),
        JSON.stringify({
          data: [
            {
              id: "0001",
              entryType: "avatar",
              nickname: `nick-${language}`,
              avatarName: `avatar-${language}`,
              category: "category",
              comment: "comment",
              author: "author",
              sourceUrl: "https://vrchat.com/home/avatar/avtr_test",
              avatarUrl: "https://vrchat.com/home/avatar/avtr_test",
            },
          ],
        }),
        "utf8",
      );
    }

    const generated = await generateCatalogSnapshots({ sourceDir, outputDir });

    assert.equal(generated.length, 3);
    for (const language of ["ja", "en", "ko"] as const) {
      const payload = JSON.parse(
        await readFile(
          path.join(outputDir, `catalog-v1-${language}.json`),
          "utf8",
        ),
      ) as { schemaVersion: number; language: string; count: number };
      assert.deepEqual(payload, {
        ...payload,
        schemaVersion: 1,
        language,
        count: 1,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
