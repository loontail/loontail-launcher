import { cn } from '@renderer/shared/lib/cn';
import { copyText } from '@renderer/shared/lib/systemApi';
import { Check, Copy } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

const FEEDBACK_MS = 1500;

// Hook for non-button contexts (e.g. toasts, custom UI). Manages the
// "just copied" flash so callers don't have to wire timers themselves.
export const useCopyText = () => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await copyText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS);
      return true;
    } catch {
      // Clipboard write can fail (focus, permission, IPC error). Swallow —
      // the caller's surface usually has the value selectable as a fallback.
      return false;
    }
  }, []);

  return { copy, copied };
};

export type CopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  text: string;
  // Visual variant. `icon` is the compact 28px square (default); `inline`
  // matches text-row affordances; `custom` renders only the children with no
  // built-in styling so callers can drop CopyButton anywhere.
  variant?: 'icon' | 'inline' | 'custom';
  // Optional renderer override. By default the button swaps a Copy → Check
  // icon on success; pass children to provide your own visual.
  children?: ((copied: boolean) => ReactNode) | ReactNode;
  // i18n label for `aria-label` / `title`. Defaults to a generic
  // "Copy to clipboard" string from the shared toast namespace.
  copyLabel?: string;
  copiedLabel?: string;
};

const VARIANT_CLASSES: Record<NonNullable<CopyButtonProps['variant']>, string> = {
  icon:
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors ' +
    'hover:bg-ghost-hover hover:text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
  inline:
    'cursor-pointer rounded-md p-1 text-glass/55 transition-colors hover:bg-ghost-hover hover:text-glass',
  custom: '',
};

const COPIED_CLASSES: Record<NonNullable<CopyButtonProps['variant']>, string> = {
  icon: 'border-success/40 bg-success/10 text-success',
  inline: 'text-success',
  custom: '',
};

export const CopyButton = ({
  text,
  variant = 'icon',
  children,
  copyLabel,
  copiedLabel,
  className,
  type = 'button',
  onClick,
  ...rest
}: CopyButtonProps) => {
  const { t } = useTranslation();
  const { copy, copied } = useCopyText();

  const label = copied
    ? (copiedLabel ?? t('common.copied', { defaultValue: 'Copied' }))
    : (copyLabel ?? t('common.copy', { defaultValue: 'Copy' }));

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClick?.(event);
    void copy(text);
  };

  const content =
    typeof children === 'function'
      ? children(copied)
      : (children ??
        (copied ? (
          <Check className={variant === 'icon' ? 'size-3.5' : 'size-3.5'} />
        ) : (
          <Copy className={variant === 'icon' ? 'size-3.5' : 'size-3.5'} />
        )));

  return (
    <button
      {...rest}
      type={type}
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={cn(VARIANT_CLASSES[variant], copied && COPIED_CLASSES[variant], className)}
    >
      {content}
    </button>
  );
};
