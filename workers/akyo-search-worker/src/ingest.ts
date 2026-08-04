import { normalizeLanguage, selectVectorIndex } from "./search";
import type {
  AkyoRecord,
  Env,
  Language,
  VectorizeIndex,
  VectorizeVector,
} from "./types";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function isAuthorizedForIngest(request: Request, token: string): boolean {
  const authorization = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }
  return timingSafeEqual(authorization.slice(prefix.length), token);
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

export async function ingestRecords(
  records: unknown[],
  env: Env
): Promise<{ processed: number; failed: number; errors: IngestError[] }> {
  const vectorsByIndex = new Map<VectorizeIndex, VectorizeVector[]>();
  const preparedRecords: AkyoRecord[] = [];
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

    try {
      const text = [
        record.nickname,
        record.name,
        record.category,
        record.description,
        record.author,
      ]
        .filter(Boolean)
        .join(" ");
      const embeddings = await env.AI.run(EMBEDDING_MODEL, { text });
      const vector = embeddings.data[0];
      if (!vector) {
        throw new Error("embedding model returned no vector");
      }

      const selected = selectVectorIndex(env);
      const vectors = vectorsByIndex.get(selected) ?? [];
      vectors.push({
        id: record.id,
        values: vector,
        metadata: { ...record, appearance: "" },
      });
      vectorsByIndex.set(selected, vectors);
      preparedRecords.push(record);
    } catch (error) {
      errors.push({ id: record.id, error: errorMessage(error) });
    }
  }

  for (const [index, vectors] of vectorsByIndex) {
    await index.upsert(vectors);
  }

  for (const record of preparedRecords) {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO akyos
        (id, nickname, name, category, description, author, url, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        record.id,
        record.nickname,
        record.name,
        record.category,
        record.description,
        record.author,
        record.url,
        record.language
      )
      .run();
  }

  return {
    processed: preparedRecords.length,
    failed: errors.length,
    errors,
  };
}
