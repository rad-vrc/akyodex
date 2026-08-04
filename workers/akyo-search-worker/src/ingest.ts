import { normalizeLanguage } from "./search";
import type { AkyoRecord, Env, Language, VectorizeVector } from "./types";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const EMBEDDING_BATCH_SIZE = 20;
const VECTOR_UPSERT_BATCH_SIZE = 100;
const INSERT_RECORD_SQL = `
  INSERT OR REPLACE INTO akyos
    (id, nickname, name, category, description, author, url, language)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
export const MAX_INGEST_RECORDS = 1_000;

interface IngestRecord {
  id?: unknown;
  nickname?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  author?: unknown;
  url?: unknown;
  language?: unknown;
}

interface IngestError {
  id: string;
  error: string;
}

interface PreparedRecord {
  record: AkyoRecord;
  vector: VectorizeVector;
}

type TimingSafeSubtleCrypto = {
  timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function tokenDigest(value: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

export async function isAuthorizedForIngest(
  request: Request,
  token: string
): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }

  const [providedDigest, expectedDigest] = await Promise.all([
    tokenDigest(authorization.slice(prefix.length)),
    tokenDigest(token),
  ]);
  const subtle = crypto.subtle as unknown as TimingSafeSubtleCrypto;
  if (subtle.timingSafeEqual) {
    return subtle.timingSafeEqual(providedDigest, expectedDigest);
  }

  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function normalizeRecord(record: IngestRecord): AkyoRecord | null {
  const id = stringValue(record.id);
  const nickname = stringValue(record.nickname);
  if (!id || !nickname) {
    return null;
  }

  const requestedLanguage = stringValue(record.language);
  const language: Language = normalizeLanguage(requestedLanguage, nickname);
  return {
    id,
    nickname,
    name: stringValue(record.name),
    category: stringValue(record.category),
    description: stringValue(record.description),
    author: stringValue(record.author),
    url: stringValue(record.url),
    language,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function embeddingText(record: AkyoRecord): string {
  return [
    record.nickname,
    record.name,
    record.category,
    record.description,
    record.author,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function ingestRecords(
  records: unknown[],
  env: Env
): Promise<{
  processed: number;
  indexed: number;
  failed: number;
  errors: IngestError[];
}> {
  const normalizedRecords: AkyoRecord[] = [];
  const preparedRecords: PreparedRecord[] = [];
  const errors: IngestError[] = [];

  for (const value of records) {
    if (value === null || typeof value !== "object") {
      errors.push({ id: "", error: "record must be an object" });
      continue;
    }
    const record = normalizeRecord(value as IngestRecord);
    if (!record) {
      errors.push({
        id: stringValue((value as IngestRecord).id),
        error: "id and nickname are required",
      });
      continue;
    }

    normalizedRecords.push(record);
  }

  for (const batch of chunksOf(normalizedRecords, EMBEDDING_BATCH_SIZE)) {
    try {
      const embeddings = await env.AI.run(EMBEDDING_MODEL, {
        text: batch.map(embeddingText),
      });
      for (const [index, record] of batch.entries()) {
        const values = embeddings.data[index];
        if (!values) {
          errors.push({
            id: record.id,
            error: "embedding model returned no vector",
          });
          continue;
        }
        preparedRecords.push({
          record,
          vector: {
            id: record.id,
            values,
            metadata: { ...record, appearance: "" },
          },
        });
      }
    } catch (error) {
      for (const record of batch) {
        errors.push({ id: record.id, error: errorMessage(error) });
      }
    }
  }

  if (preparedRecords.length === 0) {
    return { processed: 0, indexed: 0, failed: errors.length, errors };
  }

  const insertStatement = env.DB.prepare(INSERT_RECORD_SQL);
  try {
    await env.DB.batch(
      preparedRecords.map(({ record }) =>
        insertStatement.bind(
          record.id,
          record.nickname,
          record.name,
          record.category,
          record.description,
          record.author,
          record.url,
          record.language
        )
      )
    );
  } catch (error) {
    for (const { record } of preparedRecords) {
      errors.push({ id: record.id, error: errorMessage(error) });
    }
    return { processed: 0, indexed: 0, failed: errors.length, errors };
  }

  const processed = preparedRecords.length;
  let indexed = 0;
  for (const batch of chunksOf(preparedRecords, VECTOR_UPSERT_BATCH_SIZE)) {
    try {
      await env.VECTORIZE.upsert(batch.map(({ vector }) => vector));
      indexed += batch.length;
    } catch (error) {
      for (const { record } of batch) {
        errors.push({ id: record.id, error: errorMessage(error) });
      }
    }
  }

  return {
    processed,
    indexed,
    failed: errors.length,
    errors,
  };
}
