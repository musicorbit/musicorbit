import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

/**
 * Provides WCAG-compliant keyboard accessibility for modal dialogs:
 * 1. Moves focus into the modal immediately on open (preferring [data-autofocus],
 *    then the first focusable control, or the dialog container itself).
 * 2. Traps Tab / Shift+Tab focus strictly inside the modal.
 * 3. Closes the modal on Escape.
 * 4. Restores focus back to the triggering element when the modal closes.
 */
export function useModalAccessibility(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the modal on the next frame so initial children are mounted
    const frameId = window.requestAnimationFrame(() => {
      if (!dialog.isConnected) return;
      // Don't hijack focus if something inside the modal already received focus
      if (dialog.contains(document.activeElement)) return;

      const autoTarget = dialog.querySelector<HTMLElement>("[data-autofocus]");
      if (autoTarget && !autoTarget.hasAttribute("disabled")) {
        autoTarget.focus();
        return;
      }

      const focusables = getFocusableElements(dialog);
      if (focusables[0]) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusableElements(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!current || current === first || !dialog.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (!current || current === last || !dialog.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [dialogRef, active]);
}
