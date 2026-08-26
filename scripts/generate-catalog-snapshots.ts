import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serializeCatalogPayload } from "../src/lib/catalog-payload";
import type { SupportedLanguage } from "../src/lib/i18n";
import type { AkyoData } from "../src/types/akyo";

const LANGUAGES: readonly SupportedLanguage[] = ["ja", "en", "ko"];

interface GenerateCatalogSnapshotsOptions {
  sourceDir: string;
  outputDir: string;
}

function readDataArray(payload: unknown, language: SupportedLanguage): AkyoData[] {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Catalog source for ${language} must be an object`);
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Catalog source for ${language} must contain data`);
  }
  return data as AkyoData[];
}

export async function generateCatalogSnapshots(
  options: GenerateCatalogSnapshotsOptions,
): Promise<string[]> {
  await mkdir(options.outputDir, { recursive: true });

  return Promise.all(
    LANGUAGES.map(async (language) => {
      const sourcePath = path.join(
        options.sourceDir,
        `akyo-data-${language}.json`,
      );
      const outputPath = path.join(
        options.outputDir,
        `catalog-v1-${language}.json`,
      );
      const source: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
      const serialized = await serializeCatalogPayload(
        language,
        readDataArray(source, language),
      );
      await writeFile(outputPath, serialized.text, "utf8");
      return outputPath;
    }),
  );
}

export function resolveCatalogSnapshotDirectories(moduleUrl: string): {
  sourceDir: string;
  outputDir: string;
} {
  const rootDir = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
  return {
    sourceDir: path.join(rootDir, "data"),
    outputDir: path.join(rootDir, "public", "catalog"),
  };
}

async function main(): Promise<void> {
  const directories = resolveCatalogSnapshotDirectories(import.meta.url);
  const rootDir = path.dirname(directories.sourceDir);
  const generated = await generateCatalogSnapshots(directories);
  for (const filePath of generated) {
    console.log(`[catalog-snapshots] Generated ${path.relative(rootDir, filePath)}`);
  }
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error("[catalog-snapshots] Generation failed", error);
    process.exitCode = 1;
  });
}
