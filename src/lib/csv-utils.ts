/**
 * CSV Utilities
 *
 * Proper CSV parsing and stringifying using csv-parse and csv-stringify libraries.
 * Handles quoted fields, commas, newlines, and special characters correctly.
 * Also includes AkyoData type conversion utilities.
 */

import type { AkyoData } from '@/types/akyo';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { BOOTH_DISPLAY_SERIAL_PREFIX, hydrateAkyoDataset, WORLD_CATEGORY_MARKERS } from './akyo-entry';
import { ensureBoothCategories, validateBoothUrl } from './booth-url';
import type { GitHubCommitResponse, GitHubConfig } from './github-utils';
import { commitCSVToGitHub, fetchCSVFromGitHub } from './github-utils';

const BASE_AKYO_CSV_COLUMNS = ['ID', 'Nickname', 'AvatarName', 'Category', 'Comment', 'Author', 'AvatarURL'];
const SOURCE_URL_COLUMN = 'SourceURL';
const ENTRY_TYPE_COLUMN = 'EntryType';
const DISPLAY_SERIAL_COLUMN = 'DisplaySerial';
const BOOTH_URL_COLUMN = 'BoothURL';
const AKYO_EXTENDED_COLUMNS = [SOURCE_URL_COLUMN, ENTRY_TYPE_COLUMN, DISPLAY_SERIAL_COLUMN, BOOTH_URL_COLUMN];
const WORLD_ENTRY_TYPE = 'world';

interface CsvRowLengthMismatch {
  rowNumber: number;
  columnCount: number;
}

/**
 * Parse CSV content into records
 *
 * @param content - CSV file content as string
 * @returns Array of records (each record is an array of fields)
 */
function parseCSV(content: string): string[][] {
  try {
    const records: string[][] = parse(content, {
      relax_quotes: true,
      relax_column_count: true, // Allow variable column counts (will be validated later)
      skip_empty_lines: true,
      trim: false, // Preserve original whitespace
      record_delimiter: ['\r\n', '\n', '\r'], // Handle mixed line endings (Windows/Unix/Mac)
      columns: false, // Don't use first row as column names
      quote: '"', // Standard CSV quote character
      escape: '"', // Standard CSV escape character
    });
    return records;
  } catch (error) {
    console.error('CSV parsing error:', error);
    throw new Error('Failed to parse CSV file');
  }
}

function normalizeAkyoCsvShape(header: string[], dataRecords: string[][]): {
  header: string[];
  dataRecords: string[][];
} {
  const normalizedHeader = [...header];

  for (const column of AKYO_EXTENDED_COLUMNS) {
    if (!normalizedHeader.includes(column)) {
      normalizedHeader.push(column);
    }
  }

  const normalizedRows = dataRecords.map((row) =>
    normalizedHeader.map((_, index) => row[index] || '')
  );

  return {
    header: normalizedHeader,
    dataRecords: normalizedRows,
  };
}

function findCsvRowLengthMismatches(
  header: string[],
  dataRecords: string[][]
): CsvRowLengthMismatch[] {
  return dataRecords
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.length !== header.length)
    .map(({ row, rowNumber }) => ({
      rowNumber,
      columnCount: row.length,
    }));
}

function formatCsvRowLengthMismatchMessage(
  mismatches: CsvRowLengthMismatch[],
  expectedColumnCount: number
): string {
  const preview = mismatches
    .slice(0, 5)
    .map((row) => `row ${row.rowNumber}: expected ${expectedColumnCount}, got ${row.columnCount}`)
    .join('; ');

  return `Malformed CSV detected: ${mismatches.length} row(s) have invalid column counts. ${preview}`;
}

function isWorldRecord(record: string[], header: string[]): boolean {
  const entryTypeIndex = header.indexOf(ENTRY_TYPE_COLUMN);
  const categoryIndex = header.indexOf('Category');

  const explicitEntryType = entryTypeIndex >= 0 ? String(record[entryTypeIndex] || '').trim() : '';
  if (explicitEntryType === 'world') {
    return true;
  }
  if (explicitEntryType === 'avatar') {
    return false;
  }

  const rawCategory = categoryIndex >= 0 ? String(record[categoryIndex] || '') : '';
  if (!rawCategory) {
    return false;
  }

  return rawCategory
    .split(/[、,]/)
    .map((token) => token.trim().toLowerCase())
    .some((token) => WORLD_CATEGORY_MARKERS.has(token));
}

export async function loadAkyoCsv(options: {
  csvFileName?: string;
  githubConfig?: GitHubConfig;
} = {}) {
  const { csvFileName, githubConfig } = options;
  const csvFile = await fetchCSVFromGitHub(csvFileName, { config: githubConfig });
  const normalized = parseLoadedAkyoCsvContent(csvFile.content);

  return {
    header: normalized.header,
    dataRecords: normalized.dataRecords,
    fileSha: csvFile.sha,
  };
}

export function parseLoadedAkyoCsvContent(csvText: string): {
  header: string[];
  dataRecords: string[][];
} {
  const records = parseCSV(csvText);

  if (records.length === 0) {
    throw new Error('CSV file is empty');
  }

  const [header, ...dataRecords] = records;
  const rowLengthMismatches = findCsvRowLengthMismatches(header, dataRecords);
  if (rowLengthMismatches.length > 0) {
    throw new Error(formatCsvRowLengthMismatchMessage(rowLengthMismatches, header.length));
  }

  return normalizeAkyoCsvShape(header, dataRecords);
}

export async function commitAkyoCsv({
  header,
  dataRecords,
  fileSha,
  commitMessage,
  csvFileName,
  githubConfig,
}: {
  header: string[];
  dataRecords: string[][];
  fileSha: string;
  commitMessage: string;
  csvFileName?: string;
  githubConfig?: GitHubConfig;
}): Promise<GitHubCommitResponse> {
  const records = [header, ...dataRecords];
  const content = stringifyCSV(records);
  return commitCSVToGitHub(content, fileSha, commitMessage, csvFileName, githubConfig);
}

export function formatAkyoCommitMessage(
  action: 'Add' | 'Update' | 'Delete',
  id: string,
  avatarName?: string | null
): string {
  const safeName = String(avatarName ?? '').replace(/[\r\n]+/g, ' ').slice(0, 100);
  return `${action} Akyo #${id}: ${safeName}`;
}

/**
 * Stringify records into CSV content
 *
 * @param records - Array of records (each record is an array of fields)
 * @returns CSV content as string
 */
function stringifyCSV(records: string[][]): string {
  try {
    return stringify(records, {
      quoted: true, // Quote all fields for safety
      quoted_empty: true,
      record_delimiter: '\n',
    });
  } catch (error) {
    console.error('CSV stringifying error:', error);
    throw new Error('Failed to stringify CSV data');
  }
}

/**
 * Parse CSV text to AkyoData array
 * Handles both Japanese and English CSV formats
 *
 * @param csvText - CSV content as string
 * @returns Array of AkyoData objects
 */
export function parseCsvToAkyoData(csvText: string): AkyoData[] {
  const records = parseCSV(csvText);

  if (records.length < 2) {
    return []; // Need at least header + 1 data row
  }

  const [header, ...dataRecords] = records;
  const rowLengthMismatches = findCsvRowLengthMismatches(header, dataRecords);
  if (rowLengthMismatches.length > 0) {
    const preview = rowLengthMismatches
      .slice(0, 5)
      .map((row) => ({
        expected: header.length,
        got: row.columnCount,
        rowNumber: row.rowNumber,
      }));
    console.warn('Column count mismatch - skipping malformed records:', preview);
  }
  const validRecords = dataRecords.filter((record) => record.length === header.length);
  const normalized = normalizeAkyoCsvShape(header, validRecords);
  const data: AkyoData[] = [];

  for (const record of normalized.dataRecords) {
    const rawRow: Record<string, string> = {};
    normalized.header.forEach((headerName, index) => {
      // Remove BOM and whitespace from header name just in case
      const safeHeader = headerName.trim().replace(/^\ufeff/, '');
      rawRow[safeHeader] = record[index] || '';
    });

    // Map English headers to data structure
    const attribute = rawRow['Category'] || '';
    const notes = rawRow['Comment'] || '';
    const creator = rawRow['Author'] || '';
    const normalizedEntryType = (rawRow[ENTRY_TYPE_COLUMN] ?? '').trim().toLowerCase();
    const normalizedDisplaySerial = (rawRow[DISPLAY_SERIAL_COLUMN] ?? '').trim();
    const normalizedSourceUrl = (rawRow['SourceURL'] || rawRow['AvatarURL'] || '').trim();
    const normalizedAvatarUrl = (rawRow['AvatarURL'] || rawRow['SourceURL'] || '').trim();
    const boothUrl = validateBoothUrl(rawRow['BoothURL']);
    const entryType =
      normalizedEntryType === 'avatar' || normalizedEntryType === 'world'
        ? normalizedEntryType
        : undefined;
    const category = ensureBoothCategories(attribute, boothUrl, entryType);

    data.push({
      id: rawRow['ID'] ?? '',
      appearance: '', // Removed field
      nickname: rawRow['Nickname'] ?? '',
      avatarName: rawRow['AvatarName'] ?? '',

      // Standardized fields
      category,
      comment: notes,
      author: creator,
      
      // Backward compatibility fields
      attribute: category,
      notes: notes,
      creator: creator,

      entryType,
      displaySerial: normalizedDisplaySerial || undefined,
      sourceUrl: normalizedSourceUrl,
      avatarUrl: normalizedAvatarUrl,
      boothUrl,
    });
  }

  return hydrateAkyoDataset(data);
}

/**
 * Convert AkyoData array to CSV text
 *
 * @param data - Array of AkyoData objects
 * @returns CSV content as string
 */
/**
 * Find record by ID (first column)
 *
 * @param records - Array of CSV records
 * @param id - ID to search for
 * @returns Record if found, undefined otherwise
 */
export function findRecordById(records: string[][], id: string): string[] | undefined {
  return records.find((record) => {
    const recordId = String(record[0] ?? '').trim().replace(/^"|"$/g, '');
    return recordId === id;
  });
}

/**
 * Filter out record by ID (first column)
 *
 * @param records - Array of CSV records
 * @param id - ID to filter out
 * @returns Filtered array of records
 */
export function filterOutRecordById(records: string[][], id: string): string[][] {
  return records.filter((record) => {
    const recordId = String(record[0] ?? '').trim().replace(/^"|"$/g, '');
    return recordId !== id;
  });
}

/**
 * Replace record by ID (first column)
 *
 * @param records - Array of CSV records
 * @param id - ID of record to replace
 * @param newRecord - New record data
 * @returns Updated array of records
 */
export function replaceRecordById(
  records: string[][],
  id: string,
  newRecord: string[]
): string[][] {
  return records.map((record) => {
    const recordId = String(record[0] ?? '').trim().replace(/^"|"$/g, '');
    if (recordId === id) {
      return newRecord;
    }
    return record;
  });
}

function sanitizeCsvCell(value: string): string {
  const str = String(value ?? '');
  return /^[=+\-@\t]/.test(str) ? `'${str}` : str;
}

/**
 * Create a new record from form data
 * Applies CSV formula injection protection to all fields
 *
 * @param data - Object with field values
 * @returns Array of field values with security sanitization
 */
export function createAkyoRecord(data: {
  id: string;
  nickname?: string;
  avatarName: string;
  entryType?: 'avatar' | 'world' | '';
  displaySerial?: string;
  category?: string;
  author?: string;
  comment?: string;
  sourceUrl?: string;
  avatarUrl?: string;
  boothUrl?: string;
  /** backward compat */
  attributes?: string;
  creator?: string;
  notes?: string;
}, header: string[] = [...BASE_AKYO_CSV_COLUMNS, ...AKYO_EXTENDED_COLUMNS]): string[] {
  const category = data.category ?? data.attributes ?? '';
  const author = data.author ?? data.creator ?? '';
  const comment = data.comment ?? data.notes ?? '';
  const normalizedEntryType = data.entryType === 'world' ? 'world' : (data.entryType === 'avatar' ? 'avatar' : '');
  const normalizedAvatarUrl = data.avatarUrl || data.sourceUrl || '';
  const normalizedSourceUrl = data.sourceUrl || data.avatarUrl || '';
  const normalizedDisplaySerial = data.displaySerial || '';

  return header.map((columnName) => {
    switch (columnName) {
      case 'ID':
        return sanitizeCsvCell(data.id);
      case 'Nickname':
        return sanitizeCsvCell(data.nickname || '');
      case 'AvatarName':
        return sanitizeCsvCell(data.avatarName);
      case 'Category':
        return sanitizeCsvCell(category);
      case 'Comment':
        return sanitizeCsvCell(comment);
      case 'Author':
        return sanitizeCsvCell(author);
      case 'AvatarURL':
        return sanitizeCsvCell(normalizedAvatarUrl);
      case SOURCE_URL_COLUMN:
        return sanitizeCsvCell(normalizedSourceUrl);
      case ENTRY_TYPE_COLUMN:
        return sanitizeCsvCell(normalizedEntryType);
      case DISPLAY_SERIAL_COLUMN:
        return sanitizeCsvCell(normalizedDisplaySerial);
      case BOOTH_URL_COLUMN:
        return sanitizeCsvCell(data.boothUrl || '');
      default:
        return '';
    }
  });
}

function buildWorldDisplaySerialState(records: string[][], header: string[]): {
  maxSerial: number;
  serialsById: Map<string, string>;
} {
  const displaySerialIndex = header.indexOf(DISPLAY_SERIAL_COLUMN);
  const usedSerials = new Set<number>();

  for (const record of records) {
    if (!isWorldRecord(record, header)) {
      continue;
    }

    const serialSource =
      displaySerialIndex >= 0 ? String(record[displaySerialIndex] || '').trim() : '';
    const parsed = Number.parseInt(serialSource, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      usedSerials.add(parsed);
    }
  }

  let nextFallbackSerial = 1;
  const allocateFallbackSerial = () => {
    while (usedSerials.has(nextFallbackSerial)) {
      nextFallbackSerial += 1;
    }
    const allocated = nextFallbackSerial;
    usedSerials.add(allocated);
    nextFallbackSerial += 1;
    return allocated;
  };

  const serialsById = new Map<string, string>();
  let maxSerial = 0;

  for (const record of records) {
    if (!isWorldRecord(record, header)) {
      continue;
    }

    const serialSource =
      displaySerialIndex >= 0 ? String(record[displaySerialIndex] || '').trim() : '';
    const parsed = Number.parseInt(serialSource, 10);
    const resolvedSerial =
      !Number.isNaN(parsed) && parsed > 0 ? parsed : allocateFallbackSerial();
    const recordId = String(record[0] ?? '').trim().replace(/^"|"$/g, '');

    serialsById.set(recordId, String(resolvedSerial).padStart(4, '0'));
    maxSerial = Math.max(maxSerial, resolvedSerial);
  }

  return { maxSerial, serialsById };
}

export function getDisplaySerialForWorldRecord(
  records: string[][],
  header: string[],
  id: string
): string | null {
  const targetRecord = findRecordById(records, id);
  if (!targetRecord || !isWorldRecord(targetRecord, header)) {
    return null;
  }

  return buildWorldDisplaySerialState(records, header).serialsById.get(id) ?? null;
}

export function getNextDisplaySerial(
  records: string[][],
  header: string[],
  entryType: 'avatar' | 'world'
): string {
  if (entryType !== WORLD_ENTRY_TYPE) {
    return '';
  }

  return String(buildWorldDisplaySerialState(records, header).maxSerial + 1).padStart(4, '0');
}

export function getNextBoothDisplaySerialFromCsv(
  records: string[][],
  header: string[],
): string {
  const displaySerialIndex = header.indexOf(DISPLAY_SERIAL_COLUMN);
  let maxSerial = 0;

  for (const record of records) {
    const serial = displaySerialIndex >= 0 ? String(record[displaySerialIndex] || '').trim() : '';
    if (!serial.startsWith(BOOTH_DISPLAY_SERIAL_PREFIX)) {
      continue;
    }
    const numPart = serial.slice(BOOTH_DISPLAY_SERIAL_PREFIX.length);
    const parsed = Number.parseInt(numPart, 10);
    if (!Number.isNaN(parsed) && parsed > maxSerial) {
      maxSerial = parsed;
    }
  }

  return `${BOOTH_DISPLAY_SERIAL_PREFIX}${String(maxSerial + 1).padStart(4, '0')}`;
}
