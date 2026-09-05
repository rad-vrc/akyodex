import { connection } from 'next/server';
import { ensureAdminRequest, jsonError } from '@/lib/api-helpers';
import { processAkyoBatchUpdate } from '@/lib/akyo-batch-update';

export async function POST(request: Request) {
  await connection();
  const guard = await ensureAdminRequest(request);
  if ('response' in guard) return guard.response;
  // Text-only editing; do not accept image uploads through this endpoint.
  const text = await request.text();
  if (text.length > 1_000_000) return jsonError('更新データが大きすぎます', 413);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return jsonError('更新データのJSONが不正です', 400);
  }
  return processAkyoBatchUpdate(input);
}
