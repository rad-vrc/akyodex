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
import { ensureBoothCategories, validateBoothUrl } from '../src/lib/booth-url';

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
  /**
   * 元URLが最後に変わった（または新規登録された）時刻。CSV には無く、前回の JSON と
   * 比べてここで刻む。図鑑の「最新N件」がこれを内部IDより優先して見る
   */
  urlUpdatedAt?: string;
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

    const boothUrl = validateBoothUrl(rawRow['BoothURL']);
    const entryType = normalizeEntryType(rawRow['EntryType']);
    const category = ensureBoothCategories(
      normalizeHierarchicalCategories(rawRow['Category'] ?? ''),
      boothUrl,
      entryType,
    );

    data.push({
      id: rawRow['ID'] ?? '',
      entryType,
      displaySerial: rawRow['DisplaySerial'] || undefined,
      nickname: rawRow['Nickname'] ?? '',
      avatarName: rawRow['AvatarName'] ?? '',
      category,
      comment: normalizeLineEndings(rawRow['Comment'] ?? ''),
      author: rawRow['Author'] ?? '',
      sourceUrl: rawRow['SourceURL'] || rawRow['AvatarURL'] || '',
      avatarUrl: rawRow['AvatarURL'] || rawRow['SourceURL'] || '',
      boothUrl,
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

/** 前回の JSON から引き継ぐ、行ごとの URL と刻印 */
interface PreviousUrlState {
  url: string;
  urlUpdatedAt?: string;
}

function getEntryUrl(entry: Pick<AkyoData, 'sourceUrl' | 'avatarUrl'>): string {
  return (entry.sourceUrl || entry.avatarUrl || '').trim();
}

/**
 * 前回コミットされた日本語 JSON から、ID → { URL, urlUpdatedAt } を読む。
 * 無い・読めないときは null（刻印を始めない。全件が「最新」になるのを防ぐ）。
 */
async function loadPreviousUrlState(
  jsonPath: string,
): Promise<Map<string, PreviousUrlState> | null> {
  let text: string;
  try {
    text = await fs.readFile(jsonPath, 'utf-8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      console.warn(`   ⚠️ No previous JSON at ${jsonPath}; urlUpdatedAt will not be stamped this run`);
      return null;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    if (!Array.isArray(parsed.data)) {
      throw new Error('previous JSON has no data array');
    }
    const byId = new Map<string, PreviousUrlState>();
    for (const item of parsed.data as Array<Record<string, unknown>>) {
      const id = String(item.id ?? '');
      if (!id) continue;
      byId.set(id, {
        url: getEntryUrl({
          sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : undefined,
          avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : '',
        }),
        urlUpdatedAt:
          typeof item.urlUpdatedAt === 'string' && item.urlUpdatedAt.trim()
            ? item.urlUpdatedAt.trim()
            : undefined,
      });
    }
    return byId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`   ⚠️ Previous JSON at ${jsonPath} is unusable (${message}); urlUpdatedAt will not be stamped this run`);
    return null;
  }
}

/**
 * 1 行ぶんの urlUpdatedAt を決める。
 * - 前回に無い ID（新規登録）→ now
 * - URL が前回と違う → now
 * - 同じ → 前回の刻印を引き継ぐ（無ければ付けない）
 *
 * 導入前から URL が変わっていない行には何も付かないので、「刻印がある行はどれも
 * 刻印が無い行より新しい」が成り立つ（図鑑側の並べ方が前提にしている）。
 */
function resolveUrlUpdatedAt(
  current: Pick<AkyoData, 'sourceUrl' | 'avatarUrl'>,
  previous: PreviousUrlState | undefined,
  now: string,
): string | undefined {
  if (!previous) return now;
  return getEntryUrl(current) !== previous.url ? now : previous.urlUpdatedAt;
}

/** 日本語の行に刻印し、ID → 刻印 の対応を返す（EN/KO は同じ ID に同じ値を写す） */
function stampUrlUpdatedAt(
  rows: AkyoData[],
  previousById: Map<string, PreviousUrlState>,
  now: string,
): Map<string, string> {
  const stamps = new Map<string, string>();
  for (const row of rows) {
    const stamp = resolveUrlUpdatedAt(row, previousById.get(row.id), now);
    if (stamp) {
      row.urlUpdatedAt = stamp;
      stamps.set(row.id, stamp);
    } else {
      delete row.urlUpdatedAt;
    }
  }
  return stamps;
}

function applyUrlUpdatedAt(rows: AkyoData[], stamps: Map<string, string>): void {
  for (const row of rows) {
    const stamp = stamps.get(row.id);
    if (stamp) {
      row.urlUpdatedAt = stamp;
    } else {
      delete row.urlUpdatedAt;
    }
  }
}

async function convertCsvToJson() {
  const dataDir = path.join(process.cwd(), 'data');

  console.log('🔄 Starting CSV to JSON conversion...\n');

  // urlUpdatedAt は日本語の前回 JSON を基準に決め、EN/KO には同じ ID に写す
  const now = new Date().toISOString();
  const previousById = await loadPreviousUrlState(path.join(dataDir, 'akyo-data-ja.json'));
  let stampsById: Map<string, string> | null = null;

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

      if (code === 'ja') {
        if (previousById) {
          stampsById = stampUrlUpdatedAt(data, previousById, now);
          const changed = data.filter((row) => row.urlUpdatedAt === now).length;
          console.log(`   🕒 urlUpdatedAt: ${changed} row(s) stamped ${now}`);
        }
      } else if (stampsById) {
        applyUrlUpdatedAt(data, stampsById);
      }

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
