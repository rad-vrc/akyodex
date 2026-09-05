/**
 * モーダルのフォーカストラップで使う「タブ移動できる要素」の判定。
 *
 * 元は akyo-detail-modal.tsx の内部関数だったが、管理画面の編集モーダルでも
 * 同じ判定が要るため共有化した。判定基準は変えていない。
 */

export const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const computedStyle = window.getComputedStyle(element);
    return (
      computedStyle.display !== 'none' &&
      computedStyle.visibility !== 'hidden' &&
      element.closest('[aria-hidden="true"]') === null
    );
  });
}
