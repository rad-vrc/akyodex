/**
 * 三面図ダウンロードAPI
 *
 * R2から画像を取得し、Content-Disposition ヘッダー付きで返す
 * これによりクロスオリジンでもダウンロードが可能になる
 *
 * 原本 NNNN.png は同じ URL のまま差し替えられることがあるので、ブラウザには毎回
 * 再検証させる。変更が無ければ上流の 304 をそのまま返し、原寸 PNG は送らない。
 */

import { connection, NextRequest, NextResponse } from 'next/server';

import {
  buildReferenceDownloadHeaders,
  REFERENCE_DOWNLOAD_ERROR_CACHE_CONTROL,
  referenceDownloadEtagMatches,
} from '@/lib/reference-download';

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': REFERENCE_DOWNLOAD_ERROR_CACHE_CONTROL } }
  );
}

export async function GET(request: NextRequest) {
  await connection();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return jsonError('Missing id parameter', 400);
  }

  // ID のバリデーション（4桁の数字のみ許可）
  if (!/^\d{4}$/.test(id)) {
    return jsonError('Invalid id format', 400);
  }

  const r2Base = process.env.NEXT_PUBLIC_R2_BASE || 'https://images.akyodex.com';
  const imageUrl = `${r2Base}/${id}.png`;
  const ifNoneMatch = request.headers.get('if-none-match');

  try {
    // 条件付きリクエストはそのまま上流へ渡す（変更が無ければ本文を取得しない）
    const response = await fetch(
      imageUrl,
      ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : undefined
    );

    if (response.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: buildReferenceDownloadHeaders({
          id,
          etag: response.headers.get('etag') ?? ifNoneMatch,
        }),
      });
    }

    if (!response.ok) {
      return jsonError(`Image not found: ${response.status}`, response.status);
    }

    const etag = response.headers.get('etag');

    // 上流が条件付きリクエストを無視した場合の保険
    if (referenceDownloadEtagMatches(ifNoneMatch, etag)) {
      await response.body?.cancel().catch(() => undefined);
      return new NextResponse(null, {
        status: 304,
        headers: buildReferenceDownloadHeaders({ id, etag }),
      });
    }

    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: buildReferenceDownloadHeaders({
        id,
        etag,
        contentLength: imageBuffer.byteLength,
      }),
    });
  } catch (error) {
    console.error('[download-reference] Error:', error);
    return jsonError('Failed to fetch image', 500);
  }
}
