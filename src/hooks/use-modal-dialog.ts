'use client';

import { getFocusableElements } from '@/lib/focusable-elements';
import { useEffect, useRef, type RefObject } from 'react';

interface UseModalDialogOptions {
  isOpen: boolean;
  /** Escape キーで呼ばれる。未保存確認などはこの中で行う */
  onRequestClose: () => void;
  /** role="dialog" を持つパネル要素 */
  dialogRef: RefObject<HTMLElement | null>;
  /** 開いた直後にフォーカスを置く要素。未指定ならパネル内の最初の操作可能要素 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * 閉じた後にフォーカスを戻す要素。閉じる時点の `current` を読む。
   * 未指定なら、開いた時点の document.activeElement（= 開くきっかけになったボタン）へ戻す。
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * 子モーダル（カテゴリ管理など）が開いている間 true にする。
   * その間は Escape とフォーカストラップを止め、子側の操作を邪魔しない。
   */
  suspended?: boolean;
}

/**
 * IME の変換セッション中に発生したキーイベントか。
 *
 * 日本語入力の変換取消に使う Escape をモーダルの終了操作として拾わないための判定。
 * `isComposing` が標準（MDN: KeyboardEvent.isComposing）。`keyCode === 229` は
 * 変換中のキー入力をそう報告する実装（Chromium 系の一部）向けの補助で、
 * isComposing が false のまま 229 だけ立つケースを拾う。
 */
export function isComposingKeyboardEvent(
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>,
): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * body スクロールロックの参照カウント。
 *
 * 親（EditModal）と子（AttributeModal）が両方このフックを使うので、各自が
 * `body.style.overflow` を保存・復元すると、親子同時アンマウント時に
 * 「親が元の値へ戻す → 子が親の設定した hidden を戻す」の順で走り、
 * モーダルが消えた後も hidden が残る。最初のロックで元の値を保存し、
 * 最後のロック解除でだけ復元することで、解除順序に依存しなくする。
 */
let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = '';

function lockBodyScroll(): () => void {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLockCount += 1;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    bodyScrollLockCount -= 1;
    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
    }
  };
}

/**
 * WAI-ARIA APG の Modal Dialog パターンに沿った挙動をまとめたフック。
 *
 * - 開いたらパネル内へフォーカスを移す
 * - Tab / Shift+Tab はパネル内で循環する
 * - Escape で onRequestClose を呼ぶ
 * - 背面の body スクロールを止める
 * - 閉じたら returnFocusRef（未指定なら開く前にフォーカスがあった要素）へ戻す
 *
 * 公開側の akyo-detail-modal.tsx と管理画面の edit-modal.tsx が共用する。
 */
export function useModalDialog({
  isOpen,
  onRequestClose,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
  suspended = false,
}: UseModalDialogOptions) {
  // 呼び出し側が毎レンダー新しい関数を渡しても effect を張り直さないよう ref 経由で読む
  const onRequestCloseRef = useRef(onRequestClose);
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // returnFocusRef が無い場合の復帰先（= 開くきっかけになったボタン）。開いた時点で控える
    const activeElementAtOpen =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const unlockBodyScroll = lockBodyScroll();

    const focusInitialElement = () => {
      // 子モーダル表示中は子側にフォーカスを任せる
      if (suspendedRef.current) {
        return;
      }

      // rAF で既に入った後、あるいは利用者が先に別の入力欄へ移った後に
      // 50ms のフォールバックが走っても、その移動先を奪わない。
      // フォールバックは「まだどこにも入っていない」ときだけ働けばよい
      const dialog = dialogRef.current;
      const active = document.activeElement;
      if (dialog && active && dialog.contains(active)) {
        return;
      }

      const target =
        initialFocusRef?.current ??
        getFocusableElements(dialog)[0] ??
        dialog;
      target?.focus();
    };
    const initialFocusFrame = window.requestAnimationFrame(focusInitialElement);
    const fallbackFocusTimer = window.setTimeout(focusInitialElement, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) {
        return;
      }

      // 変換中の Escape は IME が変換取消に使う。ここで拾うとモーダルが閉じる
      // （未保存なら確認ダイアログが割り込む）ので、変換セッション中は何もしない
      if (isComposingKeyboardEvent(event)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onRequestCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || !dialog?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      window.clearTimeout(fallbackFocusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();

      // returnFocusRef を渡された場合はそれだけを見る（呼び出し側が復帰先を管理している）。
      // 閉じる時点の current を読むので、開いている間に差し替えられても追従する。
      // react-hooks は「cleanup 時には ref が変わっている」と警告するが、ここではその
      // 「閉じる時点の値」こそが欲しい値（呼び出し側が持つ復帰先の入れ物で、React の
      // DOM ノードに attach された ref ではない）
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const returnFocusTarget = returnFocusRef ? returnFocusRef.current : activeElementAtOpen;
      if (returnFocusTarget?.isConnected) {
        window.requestAnimationFrame(() => returnFocusTarget.focus());
      }
    };
  }, [isOpen, dialogRef, initialFocusRef, returnFocusRef]);
}
