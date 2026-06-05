import { cn } from '@renderer/shared/lib/cn';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Ref-counted so nested modals (ClientSettingsModal → UninstallConfirmModal)
// don't unlock body scroll while an outer modal is still open.
let openModalCount = 0;
let previousBodyOverflow = '';

const lockBodyScroll = () => {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openModalCount += 1;
};

const unlockBodyScroll = () => {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
};

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string | undefined;
  scrollable?: boolean;
  ariaLabel?: string | undefined;
};

export const Modal = ({
  isOpen,
  onClose,
  children,
  className,
  scrollable = false,
  ariaLabel,
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const focusableElements = useCallback((): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('aria-hidden') && element.offsetParent !== null,
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const [first] = focusableElements();
    first?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [isOpen, focusableElements]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    lockBodyScroll();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
    };
  }, [isOpen, onClose, focusableElements]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-backdrop/80',
        scrollable
          ? 'items-start justify-center overflow-y-auto py-12'
          : 'items-center justify-center',
      )}
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        // biome-ignore lint/a11y/useSemanticElements: <dialog> requires imperative showModal/close which doesn't compose with React's render-driven open state
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'glass relative flex w-full max-w-lg flex-col gap-4 rounded-md border border-border p-6 shadow-2xl',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
