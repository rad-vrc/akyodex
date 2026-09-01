/**
 * API Route: Check for duplicate nicknames or avatar names
 * POST /api/check-duplicate
 * Body: { field: 'nickname' | 'avatarName', value: string, excludeId?: string }
 * Returns: { duplicates: string[], message: string, isDuplicate: boolean }
 */

import { connection } from 'next/server';
// Phase 4: Using unified data module with JSON support
import { getAkyoData } from '@/lib/akyo-data';
import { CONTROL_CHARACTER_PATTERN, jsonError, jsonSuccess, validateOrigin } from '@/lib/api-helpers';

const MAX_DUPLICATE_CHECK_VALUE_LENGTH = 120;

export async function POST(request: Request) {
  await connection();
  try {
    // CSRF Protection: Validate Origin/Referer
    if (!validateOrigin(request)) {
      return jsonError('不正なリクエスト元です', 403);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError('リクエストボディのJSON形式が不正です。', 400);
    }
    const { field, value, excludeId } = body;

    // Validate input
    if (!field || !value || typeof value !== 'string') {
      return jsonError('不正なリクエストです。field と value が必要です。', 400);
    }

    if (field !== 'nickname' && field !== 'avatarName') {
      return jsonError('無効なフィールドです。nickname または avatarName を指定してください。', 400);
    }

    const trimmedValue = value.trim();
    if (
      trimmedValue.length === 0 ||
      trimmedValue.length > MAX_DUPLICATE_CHECK_VALUE_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(trimmedValue)
    ) {
      return jsonError(
        `入力値の形式が不正です。${MAX_DUPLICATE_CHECK_VALUE_LENGTH}文字以内で、制御文字を含まない値を入力してください。`,
        400
      );
    }

    let normalizedExcludeId: string | undefined;
    if (excludeId !== undefined && excludeId !== null) {
      if (typeof excludeId !== 'string' && typeof excludeId !== 'number') {
        return jsonError('excludeId の形式が不正です。', 400);
      }
      normalizedExcludeId = String(excludeId).trim();
      if (normalizedExcludeId.length > 32) {
        return jsonError('excludeId が長すぎます。', 400);
      }
    }

    // Get all avatar data
    const akyoData = await getAkyoData('ja');

    // Normalize function (case-insensitive, trimmed, Unicode NFC normalized)
    const normalize = (str: string | undefined): string => {
      if (!str) return '';
      return str.trim().normalize('NFC').toLowerCase();
    };

    // Find duplicates
    const targetValue = normalize(trimmedValue);
    const duplicateIds: string[] = [];

    akyoData.forEach((akyo) => {
      // Skip if this is the excluded ID (for edit operations)
      if (normalizedExcludeId && akyo.id === normalizedExcludeId) {
        return;
      }

      // Check the specified field
      const fieldValue = normalize(field === 'nickname' ? akyo.nickname : akyo.avatarName);
      if (fieldValue && fieldValue === targetValue) {
        duplicateIds.push(akyo.id);
      }
    });

    // Format response
    const isDuplicate = duplicateIds.length > 0;
    const formattedIds = duplicateIds.map((id) => {
      const numeric = parseInt(id, 10);
      if (!isNaN(numeric)) {
        return `#${String(numeric).padStart(4, '0')}`;
      }
      return `#${id}`;
    });

    let message = '';
    if (isDuplicate) {
      const fieldName = field === 'nickname' ? 'ニックネーム' : 'アバター名';
      message = `重複している${fieldName}が見つかりました: ${formattedIds.join('、')}`;
    } else {
      const fieldName = field === 'nickname' ? 'ニックネーム' : 'アバター名';
      message = `重複している${fieldName}はありません`;
    }

    return jsonSuccess({
      duplicates: formattedIds,
      message,
      isDuplicate,
    });
  } catch (error) {
    console.error('Duplicate check error:', error);
    return jsonError('サーバーエラーが発生しました。', 500);
  }
}
