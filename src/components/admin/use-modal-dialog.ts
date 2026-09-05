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
 * WAI-ARIA APG の Modal Dialog パターンに沿った挙動をまとめたフック。
 *
 * - 開いたらパネル内へフォーカスを移す
 * - Tab / Shift+Tab はパネル内で循環する
 * - Escape で onRequestClose を呼ぶ
 * - 背面の body スクロールを止める
 * - 閉じたら開く前にフォーカスがあった要素へ戻す
 *
 * akyo-detail-modal.tsx が持つ同等の実装を、管理画面向けに切り出したもの。
 */
export function useModalDialog({
  isOpen,
  onRequestClose,
  dialogRef,
  initialFocusRef,
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

    // 閉じた後にフォーカスを戻す先（= 開くきっかけになったボタン）
    const returnFocusTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusInitialElement = () => {
      const target =
        initialFocusRef?.current ??
        getFocusableElements(dialogRef.current)[0] ??
        dialogRef.current;
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
      document.body.style.overflow = previousOverflow;

      if (returnFocusTarget?.isConnected) {
        window.requestAnimationFrame(() => returnFocusTarget.focus());
      }
    };
  }, [isOpen, dialogRef, initialFocusRef]);
}
