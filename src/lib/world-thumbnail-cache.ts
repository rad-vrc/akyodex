import type { R2ObjectBody, R2PutOptions } from '@cloudflare/workers-types';
import { getVRChatWorldImageResponseHeaders, type CloudflareImageFormat } from './vrchat-world-image';

const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STALE_MS = FRESH_MS + 7 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(avif|webp|png|jpeg|gif)$/i;

type StoredImage = Pick<R2ObjectBody, 'etag' | 'size' | 'httpMetadata' | 'customMetadata' | 'arrayBuffer'>;
export interface WorldThumbnailStore {
  get(key: string): Promise<StoredImage | null>;
  put(key: string, bytes: ArrayBuffer, options: R2PutOptions): Promise<unknown>;
}

interface Thumbnail {
  bytes: ArrayBuffer;
  contentType: string;
  transformed: boolean;
  fetchedAt: number;
}

class ThumbnailFetchError extends Error {
  constructor(readonly status: number) { super(`World image unavailable (${status})`); }
}

async function readWithDeadline<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('R2 read deadline exceeded')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function responseFor(image: Thumbnail, state: string, now: number): Response {
  const headers = getVRChatWorldImageResponseHeaders(image.contentType);
  // A stale result must not buy another day of freshness in the browser.
  const seconds = state === 'STALE' ? 60 : Math.max(0, Math.min(3600, Math.floor((image.fetchedAt + FRESH_MS - now) / 1000)));
  headers.set('Cache-Control', `public, max-age=${seconds}`);
  headers.set('X-Image-Transformed', String(image.transformed));
  headers.set('X-World-Image-Cache', state);
  headers.set('X-World-Image-Fetched-At', String(image.fetchedAt));
  return new Response(image.bytes, { headers });
}

async function readImage(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('Empty image body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_IMAGE_BYTES) throw new Error('World image exceeds cache size limit');
      chunks.push(value);
    }
    if (!length) throw new Error('Empty image body');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}

export async function serveWorldThumbnail(args: {
  wrld: string;
  width: number;
  format: CloudflareImageFormat | null;
  store: WorldThumbnailStore | null;
  load: (signal: AbortSignal) => Promise<Response>;
  after: (task: () => Promise<void>) => void;
  now?: () => number;
  timeoutMs?: number;
  cacheReadTimeoutMs?: number;
  warn?: (reason: string) => void;
}): Promise<Response> {
  const { wrld, width, format, load, after, now = Date.now, timeoutMs = 20_000, cacheReadTimeoutMs = 1000,
    warn = reason => console.warn('[world-thumbnail-cache]', JSON.stringify({ wrld, reason })) } = args;
  const key = `world-thumbnails/v1/${wrld}/${width}/${format ?? 'original'}`;
  let store = args.store;
  let previous: StoredImage | null = null;
  try { previous = store ? await readWithDeadline(store.get(key), cacheReadTimeoutMs) : null; }
  catch { warn('cache-read-failed'); store = null; }

  const update = async (image: Thumbnail) => {
    if (!store) return;
    try {
      await store.put(key, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { fetchedAt: String(image.fetchedAt), transformed: String(image.transformed) },
        // Another request may have refreshed the same object while we fetched.
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
      });
    } catch { warn('cache-write-failed'); }
  };

  const fetchLatest = async (): Promise<Thumbnail> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new ThumbnailFetchError(504)); controller.abort(); }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        const response = await load(controller.signal);
        const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim() ?? '';
        if (!response.ok || !IMAGE_TYPE.test(contentType)) {
          await response.body?.cancel().catch(() => {});
          throw new ThumbnailFetchError(response.status >= 400 ? response.status : 502);
        }
        const bytes = await readImage(response, controller.signal);
        controller.signal.throwIfAborted();
        return { bytes, contentType, transformed: response.headers.get('X-Image-Transformed') === 'true', fetchedAt: now() };
      })(), expired]);
    } finally { clearTimeout(timer); }
  };

  const fetchedAt = Number(previous?.customMetadata?.fetchedAt);
  const age = now() - fetchedAt;
  if (previous && Number.isFinite(fetchedAt) && fetchedAt > 0 && age >= 0 && age < MAX_STALE_MS &&
      previous.size > 0 && previous.size <= MAX_IMAGE_BYTES && IMAGE_TYPE.test(previous.httpMetadata?.contentType ?? '')) {
    try {
      const image: Thumbnail = { bytes: await readWithDeadline(previous.arrayBuffer(), cacheReadTimeoutMs), contentType: previous.httpMetadata!.contentType!,
        transformed: previous.customMetadata?.transformed === 'true', fetchedAt };
      if (image.bytes.byteLength !== previous.size) throw new Error('Incomplete cached image');
      if (age >= FRESH_MS) after(async () => {
        try { await update(await fetchLatest()); } catch { warn('refresh-failed'); }
      });
      return responseFor(image, age < FRESH_MS ? 'HIT' : 'STALE', now());
    } catch { warn('cache-body-failed'); }
  }

  try {
    const image = await fetchLatest();
    if (store) after(() => update(image));
    return responseFor(image, store ? 'MISS' : 'BYPASS', now());
  } catch (error) {
    warn('live-fetch-failed');
    return Response.json({ error: 'Failed to fetch VRChat world image' }, { status: error instanceof ThumbnailFetchError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
