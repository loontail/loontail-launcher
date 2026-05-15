import { cn } from '@renderer/shared/lib/cn';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

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
      {/* biome-ignore lint/a11y/useSemanticElements: a <dialog> element requires imperative showModal()/close() that doesn't compose with React's render-driven open state */}
      <div
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
