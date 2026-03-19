/**
 * CSV to JSON Converter for Akyo Data
 *
 * This script converts Akyo CSV files to JSON format for faster data loading.
 * Run with: npx tsx scripts/csv-to-json.ts
 *
 * Phase 4 Implementation: R2 JSON Data Cache
 */

import { parse } from 'csv-parse/sync';
import { promises as fs } from 'fs';
import path from 'path';
import { validateBoothUrl } from '../src/lib/booth-url';

interface AkyoData {
  id: string;
  entryType?: 'avatar' | 'world';
  displaySerial?: string;
  nickname: string;
  avatarName: string;
  category: string;
  comment: string;
  author: string;
  sourceUrl?: string;
  avatarUrl: string;
  boothUrl?: string;
}

interface AkyoJsonOutput {
  version: string;
  language: string;
  updatedAt: string;
  count: number;
  data: AkyoData[];
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeEntryType(
  value: string | undefined,
): 'avatar' | 'world' | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'avatar' || normalized === 'world'
    ? normalized
    : undefined;
}

/**
 * Ensure every subcategory token has all ancestor tokens in the same category list.
 * Example: "A/B/C,D" -> "A,A/B,A/B/C,D"
 */
function normalizeHierarchicalCategories(category: string): string {
  const tokens = category
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.includes('/')) {
      const parts = token.split('/');
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join('/');
        if (!seen.has(ancestor)) {
          normalized.push(ancestor);
          seen.add(ancestor);
        }
      }
    }

    if (!seen.has(token)) {
      normalized.push(token);
      seen.add(token);
    }
  }

  return normalized.join(',');
}

/**
 * Parse CSV content into AkyoData array
 */
function parseCsvToAkyoData(csvText: string): AkyoData[] {
  const records: string[][] = parse(csvText, {
    // Strict parsing is required to fail fast on malformed CSV.
    skip_empty_lines: true,
    trim: false,
    record_delimiter: ['\r\n', '\n', '\r'],
    columns: false,
    quote: '"',
    escape: '"',
  });

  if (records.length < 2) {
    return [];
  }

  const [header, ...dataRecords] = records;
  const data: AkyoData[] = [];
  const invalidRows: Array<{ rowNumber: number; columnCount: number }> = [];

  for (const [index, record] of dataRecords.entries()) {
    if (record.length !== header.length) {
      invalidRows.push({
        rowNumber: index + 2, // +1 for zero-based index and +1 for header row
        columnCount: record.length,
      });
      continue;
    }

    const rawRow: Record<string, string> = {};
    header.forEach((headerName, index) => {
      const safeHeader = headerName.trim().replace(/^\ufeff/, '');
      rawRow[safeHeader] = record[index] || '';
    });

    data.push({
      id: rawRow['ID'] ?? '',
      entryType: normalizeEntryType(rawRow['EntryType']),
      displaySerial: rawRow['DisplaySerial'] || undefined,
      nickname: rawRow['Nickname'] ?? '',
      avatarName: rawRow['AvatarName'] ?? '',
      category: normalizeHierarchicalCategories(rawRow['Category'] ?? ''),
      comment: normalizeLineEndings(rawRow['Comment'] ?? ''),
      author: rawRow['Author'] ?? '',
      sourceUrl: rawRow['SourceURL'] || rawRow['AvatarURL'] || '',
      avatarUrl: rawRow['AvatarURL'] || rawRow['SourceURL'] || '',
      boothUrl: validateBoothUrl(rawRow['BoothURL']),
    });
  }

  if (invalidRows.length > 0) {
    const preview = invalidRows
      .slice(0, 5)
      .map((row) => `row ${row.rowNumber}: expected ${header.length}, got ${row.columnCount}`)
      .join('; ');
    throw new Error(
      `Malformed CSV detected: ${invalidRows.length} row(s) have invalid column counts. ${preview}`
    );
  }

  return data;
}

async function convertCsvToJson() {
  const dataDir = path.join(process.cwd(), 'data');

  console.log('🔄 Starting CSV to JSON conversion...\n');

  // Language definitions
  const languages = [
    { code: 'ja', file: 'akyo-data-ja.csv' },
    { code: 'en', file: 'akyo-data-en.csv' },
    { code: 'ko', file: 'akyo-data-ko.csv' },
  ] as const;

  type LanguageCode = (typeof languages)[number]['code'];
  const requiredLanguages = new Set<LanguageCode>(['ja', 'en']);
  const failedConversions: Array<{
    code: LanguageCode;
    file: string;
    csvPath: string;
    message: string;
  }> = [];

  const jsonPaths: string[] = [];

  for (const { code, file } of languages) {
    console.log(`📝 Processing ${code.toUpperCase()} CSV (${file})...`);
    const csvPath = path.join(dataDir, file);

    try {
      const csv = await fs.readFile(csvPath, 'utf-8');
      const data = parseCsvToAkyoData(csv);

      const akyoJsonOutput: AkyoJsonOutput = {
        version: '1.0',
        language: code,
        updatedAt: new Date().toISOString(),
        count: data.length,
        data,
      };

      const jsonPath = path.join(dataDir, `akyo-data-${code}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(akyoJsonOutput, null, 2), 'utf-8');
      console.log(`   ✅ ${code.toUpperCase()}: ${data.length} avatars → ${jsonPath}`);
      jsonPaths.push(jsonPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      const message = error instanceof Error ? error.message : String(error);
      if (nodeError.code === 'ENOENT') {
        failedConversions.push({ code, file, csvPath, message });
        console.warn(
          `   ⚠️ Skipping ${code.toUpperCase()} (${file}) at ${csvPath}: ${message}`
        );
        continue;
      }

      throw new Error(
        `CSV conversion failed for ${code.toUpperCase()} (${file}) at ${csvPath}: ${message}`
      );
    }
  }

  const requiredFailures = failedConversions.filter((failure) =>
    requiredLanguages.has(failure.code)
  );

  if (requiredFailures.length > 0) {
    const summary = requiredFailures
      .map(({ code, file, message }) => `${code.toUpperCase()} (${file}): ${message}`)
      .join(' | ');
    throw new Error(`Required CSV conversion failed: ${summary}`);
  }

  if (failedConversions.length > 0) {
    const summary = failedConversions
      .map(({ code, file }) => `${code.toUpperCase()} (${file})`)
      .join(', ');
    console.warn(`⚠️ Optional CSV conversion failures occurred: ${summary}`);
  }

  // Summary
  console.log('\n✨ Conversion complete!');
  console.log('\nGenerated files:');
  for (const p of jsonPaths) {
    console.log(`   - ${p}`);
  }
  console.log('\nTo use JSON data, set environment variable:');
  console.log('   NEXT_PUBLIC_USE_JSON_DATA=true');
}

// Run if executed directly
convertCsvToJson()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
