/**
 * API Route: Get Next Available Akyo ID
 * GET /api/admin/next-id
 * Returns: { nextId: string }
 *
 * Finds the maximum ID in the CSV and returns the next available 4-digit ID.
 */

import { connection } from 'next/server';
import { jsonError, validateSession } from '@/lib/api-helpers';
import { fetchCSVFromGitHub } from '@/lib/github-utils';
import { computeNextIdFromCsv } from '@/lib/csv-utils';
import { formatAkyoId, parseAkyoIdNumber, pickLatestAkyoId, readNextIdHint } from '@/lib/next-id-state';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import fs from 'fs/promises';
import path from 'path';

interface R2TextObject {
  text: () => Promise<string>;
}

interface R2BucketBinding {
  get: (key: string) => Promise<R2TextObject | null>;
}

interface NextIdEnv {
  AKYO_BUCKET?: R2BucketBinding;
}

const DEFAULT_CSV_PATH = 'data/akyo-data-ja.csv';
const GITHUB_CSV_URL =
  'https://raw.githubusercontent.com/rad-vrc/Akyodex/main/data/akyo-data-ja.csv';
const FETCH_TIMEOUT_MS = 5000;
const R2_FETCH_TIMEOUT_MS = 3000;
const NEXT_ID_CACHE_TTL_MS = 1500;
const GITHUB_API_TIMEOUT_MS = 3500;
const NEXT_ID_RESOLVE_TIMEOUT_MS = 9000;

let cachedCsvNextId: { value: number; expiresAt: number } | null = null;

function addCacheBuster(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_ts=${Date.now()}`;
}

async function fetchCsvText(url: string): Promise<string | null> {
  try {
    const response = await fetch(addCacheBuster(url), {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[next-id] Fetch timeout for ${url}`);
    }
    return null;
  }
}

function getCachedCsvNextId(): number | null {
  if (!cachedCsvNextId) return null;
  if (cachedCsvNextId.expiresAt < Date.now()) {
    cachedCsvNextId = null;
    return null;
  }
  return cachedCsvNextId.value;
}

function setCachedCsvNextId(idNum: number): void {
  cachedCsvNextId = {
    value: idNum,
    expiresAt: Date.now() + NEXT_ID_CACHE_TTL_MS,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(timeoutMessage);
      resolve(fallbackValue);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchR2ObjectWithTimeout(
  bucket: R2BucketBinding,
  csvPath: string
): Promise<R2TextObject | null> {
  try {
    return await withTimeout(
      bucket.get(csvPath),
      R2_FETCH_TIMEOUT_MS,
      null,
      `[next-id] R2 read timed out for ${csvPath}`
    );
  } catch (error) {
    console.warn(`[next-id] Failed to read R2 object for ${csvPath}:`, error);
    return null;
  }
}

async function resolveCsvNextId(bucket: R2BucketBinding | undefined): Promise<number> {
  let csvContent = '';

  if (!bucket) {
    // Development: Prefer local workspace CSV to avoid remote sync lag.
    try {
      const localCsvPath = path.join(process.cwd(), DEFAULT_CSV_PATH);
      csvContent = await fs.readFile(localCsvPath, 'utf-8');
    } catch {
      csvContent = '';
    }
  }

  if (!csvContent && bucket) {
    // Fast source: R2 bucket (supports legacy and current key layouts).
    const configuredPath = process.env.GITHUB_CSV_PATH_JA;
    const candidatePaths = [configuredPath, 'akyo-data/akyo-data-ja.csv', DEFAULT_CSV_PATH].filter(
      (value): value is string => Boolean(value)
    );

    for (const csvPath of candidatePaths) {
      const csvObject = await fetchR2ObjectWithTimeout(bucket, csvPath);
      if (csvObject) {
        csvContent = await csvObject.text();
        break;
      }
    }
  }

  if (!csvContent) {
    // Fallback to public R2 URL.
    const r2BaseUrl = process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com';
    const publicCsvUrls = [
      `${r2BaseUrl}/akyo-data/akyo-data-ja.csv`,
      `${r2BaseUrl}/data/akyo-data-ja.csv`,
    ];

    for (const csvUrl of publicCsvUrls) {
      const fetched = await fetchCsvText(csvUrl);
      if (fetched) {
        csvContent = fetched;
        break;
      }
    }
  }

  if (!csvContent) {
    // Authoritative fallback: GitHub API (short timeout to avoid admin UI stalls).
    try {
      const githubCsv = await fetchCSVFromGitHub('akyo-data-ja.csv', {
        timeoutMs: GITHUB_API_TIMEOUT_MS,
      });
      csvContent = githubCsv.content;
    } catch {
      csvContent = '';
    }
  }

  if (!csvContent) {
    // Final fallback: GitHub raw CSV.
    const githubCsv = await fetchCsvText(GITHUB_CSV_URL);
    if (githubCsv) {
      csvContent = githubCsv;
    }
  }

  return csvContent ? computeNextIdFromCsv(csvContent) : 1;
}

export async function GET() {
  await connection();
  // Validate admin session
  const session = await validateSession();
  if (!session) {
    return jsonError('Unauthorized', 401);
  }

  try {
    let csvNextIdNum = getCachedCsvNextId();

    // Resolve Cloudflare bindings for bucket/KV access when available.
    let env: NextIdEnv | undefined;
    try {
      const ctx = getCloudflareContext();
      env = ctx?.env as NextIdEnv | undefined;
    } catch {
      env = undefined;
    }

    const bucket = env?.AKYO_BUCKET;

    if (csvNextIdNum === null) {
      csvNextIdNum = await withTimeout(
        resolveCsvNextId(bucket),
        NEXT_ID_RESOLVE_TIMEOUT_MS,
        1,
        `[next-id] CSV resolution timed out after ${NEXT_ID_RESOLVE_TIMEOUT_MS}ms; using fallback ID 0001`
      );
      setCachedCsvNextId(csvNextIdNum);
    }

    const hintedNextIdNum = await readNextIdHint();
    const mergedNextIdNum = pickLatestAkyoId(
      parseAkyoIdNumber(csvNextIdNum),
      hintedNextIdNum
    );
    const nextId = formatAkyoId(mergedNextIdNum ?? 1);

    return Response.json({ nextId });
  } catch (error) {
    console.error('[next-id] Error:', error);
    return jsonError('Failed to fetch next ID', 500, { nextId: '0001' });
  }
}
