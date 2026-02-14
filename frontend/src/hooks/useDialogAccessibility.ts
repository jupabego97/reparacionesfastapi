import { useCallback, useEffect, useId, useRef } from 'react';

type Options = {
  onClose: () => void;
  enabled?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => !el.hasAttribute('disabled'));

export function useDialogAccessibility({ onClose, enabled = true, initialFocusRef }: Options) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!enabled) return;

    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusInitialElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const firstFocusable = initialFocusRef?.current || getFocusableElements(dialog)[0] || dialog;
      firstFocusable.focus();
    };

    const raf = requestAnimationFrame(focusInitialElement);

    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus();
    };
  }, [enabled, initialFocusRef]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }, [enabled, onClose]);

  return { dialogRef, titleId, onKeyDown };
}

