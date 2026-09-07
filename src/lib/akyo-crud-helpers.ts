/**
 * Akyo CRUD Operations Helper
 * 
 * Provides unified logic for Create, Update, Delete operations
 * to eliminate code duplication across API routes.
 */

import type { AkyoFormData } from './api-helpers';
import { jsonError } from './api-helpers';
import {
    ensureWorldCategory,
    resolveDisplaySerialForEntryUpdate,
    WORLD_CATEGORY_MARKERS,
} from './akyo-entry';
import {
    CSV_CONFLICT_MESSAGE,
    commitAkyoCsvSnapshot,
    findUnregisteredCategories,
    loadAkyoCsvSnapshot,
    unregisteredCategoryMessage,
    type AkyoCsvCommit,
    type AkyoCsvSnapshot,
} from './akyo-csv-snapshot';
import { ensureBoothCategories } from './booth-url';
import { ensureCategoryAncestors } from './category-operations';
import {
    createAkyoRecord,
    filterOutRecordById,
    findRecordById,
    formatAkyoCommitMessage,
    getDisplaySerialForWorldRecord,
    getNextBoothDisplaySerialFromCsv,
    getNextDisplaySerial,
    replaceRecordById,
} from './csv-utils';
import { GitHubConflictError } from './github-utils';
import { persistNextIdHint } from './next-id-state';
import type { R2UploadOptions, R2UploadResult } from './r2-utils';
import { deleteImageFromR2, uploadImageToR2 } from './r2-utils';

type CrudOperation = 'add' | 'update' | 'delete';

interface CrudResult {
    success: boolean;
    message: string;
    commitUrl?: string;
    imageUploaded?: boolean;
    imageUpdated?: boolean;
    imageDeleted?: boolean;
    warning?: string;
}

interface DeleteData {
    id: string;
    avatarName?: string;
}

function normalizeCategoryFieldForEntryType(
    value: string,
    entryType: 'avatar' | 'world'
): string {
    const categories = value
        .split(/[、,]/)
        .map((category) => category.trim())
        .filter(Boolean);

    const normalizedCategories =
        entryType === 'world' ? ensureWorldCategory(categories) : categories;

    return normalizedCategories.join(',');
}

function resolveEntryTypeFromRecord(
    record: string[],
    header: string[]
): 'avatar' | 'world' {
    const entryTypeIndex = header.indexOf('EntryType');
    const categoryIndex = header.indexOf('Category');
    const explicitEntryType =
        entryTypeIndex >= 0 ? String(record[entryTypeIndex] || '').trim() : '';

    if (explicitEntryType === 'avatar' || explicitEntryType === 'world') {
        return explicitEntryType;
    }

    const categories =
        categoryIndex >= 0
            ? String(record[categoryIndex] || '')
                .split(/[、,]/)
                .map((category) => category.trim().toLowerCase())
                .filter(Boolean)
            : [];

    return categories.some((category) => WORLD_CATEGORY_MARKERS.has(category))
        ? 'world'
        : 'avatar';
}

type RecordData = Parameters<typeof createAkyoRecord>[0];

/** Shared update semantics for the legacy single-update route and batch editing. */
export function prepareAkyoUpdate(
    form: AkyoFormData,
    dataRecords: string[][],
    header: string[],
): string[][] {
    const existingRecord = findRecordById(dataRecords, form.id);
    if (!existingRecord) throw new Error(`ID: ${form.id} が見つかりませんでした`);
    const isBoothOnly = !form.sourceUrl && !!form.boothUrl;
    const entryType = isBoothOnly ? undefined : form.entryType === 'world' ? 'world' : 'avatar';
    const category = ensureCategoryAncestors(
        entryType ? normalizeCategoryFieldForEntryType(form.category, entryType) : form.category,
    );
    const recordData: RecordData = {
        ...form,
        entryType,
        category: ensureBoothCategories(category, form.boothUrl, entryType),
        avatarUrl: form.sourceUrl || form.avatarUrl,
    };
    const id = form.id;
    const originalEntryType = resolveEntryTypeFromRecord(existingRecord, header);

    if (isBoothOnly) {
        // BOOTH専用: 既存のBooth連番を維持、なければ新規割り当て
        const displaySerialIndex = header.indexOf('DisplaySerial');
        const existingSerial = displaySerialIndex >= 0
            ? String(existingRecord[displaySerialIndex] || '').trim()
            : '';
        recordData.displaySerial = existingSerial.startsWith('Booth')
            ? existingSerial
            : getNextBoothDisplaySerialFromCsv(dataRecords, header);
    } else if (recordData.entryType === 'world') {
        const displaySerialIndex = header.indexOf('DisplaySerial');
        const originalDisplaySerial =
            originalEntryType === 'world'
                ? (
                    (displaySerialIndex >= 0
                        ? String(existingRecord[displaySerialIndex] || '').trim()
                        : '') ||
                    getDisplaySerialForWorldRecord(dataRecords, header, id) ||
                    undefined
                )
                : undefined;
        recordData.displaySerial = resolveDisplaySerialForEntryUpdate({
            entryType: 'world',
            id,
            currentDisplaySerial: recordData.displaySerial,
            originalDisplaySerial,
            originalEntryType,
            nextWorldDisplaySerial: getNextDisplaySerial(dataRecords, header, 'world'),
        });
    } else {
        // アバター更新: フォームの値 → 既存レコードの値 → ID の優先順で保持
        const displaySerialIndex = header.indexOf('DisplaySerial');
        const existingSerial = displaySerialIndex >= 0
            ? String(existingRecord[displaySerialIndex] || '').trim()
            : '';
        recordData.displaySerial = recordData.displaySerial || existingSerial || id;
    }
    const updated = createAkyoRecord(recordData, header);
    return replaceRecordById(dataRecords, form.id, updated);
}

/**
 * Process Akyo CRUD operation (Add/Update/Delete)
 * Handles CSV commit first, then image operation
 */
export interface AkyoCrudDependencies {
    loadSnapshot: () => Promise<AkyoCsvSnapshot>;
    commit: (args: AkyoCsvCommit) => Promise<{ commit: { html_url: string } }>;
}

export async function processAkyoCRUD(
    operation: CrudOperation,
    formData: AkyoFormData | DeleteData,
    dependencies: Partial<AkyoCrudDependencies> = {},
): Promise<Response> {
    const { loadSnapshot = loadAkyoCsvSnapshot, commit: commitCsv = commitAkyoCsvSnapshot } = dependencies;
    const { id } = formData;
    
    // 分割代入で新旧フィールドを取得
    const { 
        nickname, 
        avatarName, 
        entryType,
        displaySerial,
        sourceUrl,
        boothUrl,
        avatarUrl,
        imageData,
        category,
        author,
        comment,
        attributes,
        creator,
        notes
    } = 'nickname' in formData
        ? formData
        : {
            nickname: '',
            avatarName: '',
            entryType: 'avatar',
            displaySerial: undefined,
            sourceUrl: '',
            boothUrl: undefined,
            avatarUrl: '',
            imageData: undefined,
            category: '',
            author: '',
            comment: '',
            attributes: '',
            creator: '',
            notes: ''
        };

    try {
        // Step 1: Load the CSV and the category registry from one commit
        const snapshot = await loadSnapshot();
        const { head, header, dataRecords } = snapshot;

        // Step 2: Validate and prepare data based on operation
        let updatedRecords: string[][];
        let commitMessageAction: string;
        let successMessage: string;
        // BOOTH専用検出: sourceUrlなし && boothUrlあり
        const isBoothOnly = !sourceUrl && !!boothUrl;
        const normalizedEntryType: 'avatar' | 'world' | '' = isBoothOnly ? '' : (entryType === 'world' ? 'world' : 'avatar');
        // 子だけを持つ行はカードでは正しく見えるのに「色」の絞り込みから消える。画面が
        // 親を足し忘れても行の形が崩れないよう、検査と書き込みの両方でここを通す
        const submittedCategory = ensureCategoryAncestors(category || attributes);
        const normalizedCategory = normalizedEntryType
            ? normalizeCategoryFieldForEntryType(
                submittedCategory,
                normalizedEntryType,
            )
            : submittedCategory;

        const categoryWithBooth = ensureBoothCategories(
            normalizedCategory,
            boothUrl,
            isBoothOnly ? undefined : normalizedEntryType || undefined,
        );

        // A form opened before another admin renamed or deleted a category would otherwise
        // write a token with no translation, which stops the EN/KO regeneration. Check what
        // the client submitted, not the markers the server itself adds afterwards.
        if (operation !== 'delete') {
            const unknown = findUnregisteredCategories(snapshot, [submittedCategory]);
            if (unknown.length > 0) {
                return jsonError(unregisteredCategoryMessage(unknown), 400);
            }
        }

        const recordData: Parameters<typeof createAkyoRecord>[0] = {
            id,
            nickname,
            avatarName,
            entryType: normalizedEntryType || undefined,
            displaySerial,
            sourceUrl,
            // 新フィールドを優先
            attributes: categoryWithBooth,
            creator: author || creator,
            notes: comment || notes,
            avatarUrl: sourceUrl || avatarUrl,
            boothUrl,
        };

        switch (operation) {
            case 'add': {
                // Check for duplicate ID
                const duplicateRecord = findRecordById(dataRecords, id);
                if (duplicateRecord) {
                    return jsonError(`ID ${id} は既に使用されています`, 409);
                }

                if (isBoothOnly) {
                    recordData.displaySerial = getNextBoothDisplaySerialFromCsv(dataRecords, header);
                } else if (recordData.entryType === 'world') {
                    recordData.displaySerial = getNextDisplaySerial(dataRecords, header, 'world');
                } else {
                    recordData.displaySerial = getNextDisplaySerial(dataRecords, header, 'avatar');
                }

                // Create and add new record
                const newRecord = createAkyoRecord(recordData, header);
                updatedRecords = [...dataRecords, newRecord];
                commitMessageAction = 'Add';
                successMessage = 'Akyoを登録しました';
                break;
            }

            case 'update': {
                // Check if record exists
                const existingRecord = findRecordById(dataRecords, id);
                if (!existingRecord) {
                    return jsonError(`ID: ${id} が見つかりませんでした`, 404);
                }
                if (!('nickname' in formData)) return jsonError('更新データが不足しています', 400);
                updatedRecords = prepareAkyoUpdate(formData, dataRecords, header);
                commitMessageAction = 'Update';
                successMessage = 'Akyoを更新しました';
                break;
            }

            case 'delete': {
                // Check if record exists
                const recordToDelete = findRecordById(dataRecords, id);
                if (!recordToDelete) {
                    return jsonError(`ID: ${id} が見つかりませんでした`, 404);
                }

                updatedRecords = filterOutRecordById(dataRecords, id);
                commitMessageAction = 'Delete';
                successMessage = `Akyoを削除しました (ID: ${id})`;
                break;
            }
        }

        // Step 3: Commit CSV to GitHub
        const commitMessage = formatAkyoCommitMessage(
            commitMessageAction as 'Add' | 'Update' | 'Delete',
            id,
            avatarName || nickname || ''
        );
        // Applied to the commit the checks above read, without force: a category renamed or
        // deleted in between (which may not touch the CSV at all) fails instead of winning.
        const commitData = await commitCsv({
            parentSha: head,
            header,
            dataRecords: updatedRecords,
            message: commitMessage,
        });

        if (operation === 'add') {
            const currentId = Number.parseInt(id, 10);
            if (!Number.isNaN(currentId)) {
                await persistNextIdHint(currentId + 1);
            }
        }

        // Step 4: Handle image operation (after successful CSV commit)
        const imageResult = await handleImageOperation(operation, id, imageData);

        // Step 5: Build response
        const result: CrudResult = {
            success: true,
            message: imageResult.warning ? `${successMessage}が、${imageResult.warning}` : successMessage,
            commitUrl: commitData.commit.html_url,
            ...imageResult,
        };

        return Response.json(result);

    } catch (error) {
        if (error instanceof GitHubConflictError) {
            return jsonError(CSV_CONFLICT_MESSAGE, 409);
        }
        console.error(`[akyo-crud-${operation}] Error:`, error);
        return jsonError(
            error instanceof Error ? error.message : 'CSVの更新に失敗しました',
            500
        );
    }
}

/**
 * Handle image operations based on CRUD operation type
 */
async function handleImageOperation(
    operation: CrudOperation,
    id: string,
    imageData?: string
): Promise<Partial<CrudResult>> {
    if (operation === 'delete') {
        // Delete image from R2
        const deleteResult: R2UploadResult = await deleteImageFromR2(id);
        if (!deleteResult.success) {
            console.error('[akyo-crud-delete] Image deletion warning:', deleteResult.error);
        }
        return { imageDeleted: deleteResult.success };
    }

    // Add or Update: Upload image if provided
    if (!imageData) {
        return operation === 'add' ? { imageUploaded: false } : { imageUpdated: false };
    }

    const uploadOptions: R2UploadOptions = {
        contentType: 'image/webp',
        maxSizeBytes: 5 * 1024 * 1024,
    };

    const uploadResult: R2UploadResult = await uploadImageToR2(id, imageData, uploadOptions);

    if (!uploadResult.success) {
        const action = operation === 'add' ? 'アップロード' : '更新';
        console.error(`[akyo-crud-${operation}] Image ${action} error:`, uploadResult.error);
        return {
            [operation === 'add' ? 'imageUploaded' : 'imageUpdated']: false,
            warning: (uploadResult.error as string | undefined) || `画像の${action}に失敗しました。後で再試行してください。`,
        };
    }

    return operation === 'add' ? { imageUploaded: true } : { imageUpdated: true };
}
