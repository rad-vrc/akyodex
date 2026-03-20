export interface WorldRegistrationAssets {
  imageFile: File | null;
  resolvedAuthor: string;
  resolvedNickname: string;
}

export function assertWorldRegistrationAssets(
  assets: WorldRegistrationAssets,
): void {
  const { resolvedNickname, resolvedAuthor, imageFile } = assets;

  if (!resolvedNickname || !resolvedAuthor) {
    throw new Error(
      "ワールド情報の自動取得が一部不足しました。通称欄と作者欄を確認して、もう一度登録してください。",
    );
  }

  if (!imageFile) {
    console.warn(
      "[world-registration] ワールド画像を取得できませんでした。画像なしで登録を続行します。",
    );
  }
}
