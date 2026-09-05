import { IconSearch } from '@/components/icons';
import { Spinner } from './spinner';

/**
 * 重複確認ボタン。ラベル行の右端に置く（登録画面・編集モーダル共通）。
 * 可視文言は短く共通にし、対象フィールド名は aria-label で補って
 * 複数のボタンを読み上げで区別できるようにする（可視文言は aria-label に含める）。
 */
export function DuplicateCheckButton({
  checking,
  onClick,
  fieldLabel,
}: {
  checking: boolean;
  onClick: () => void;
  fieldLabel: string;
}) {
  const label = '重複を確認';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={checking}
      aria-label={`${fieldLabel}の${label}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-orange-200 text-orange-700 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {checking ? (
        <>
          <Spinner className="w-3.5 h-3.5" />
          確認中...
        </>
      ) : (
        <>
          <IconSearch size="w-4 h-4" />
          {label}
        </>
      )}
    </button>
  );
}
