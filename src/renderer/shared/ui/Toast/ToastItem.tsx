import { cn } from '@renderer/shared/lib/cn';
import { useCopyText } from '@renderer/shared/ui/CopyButton';
import { AlertTriangle, CheckCircle2, Copy, Info, X, XCircle } from 'lucide-react';
import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type ToastPayload, type ToastVariant, ToastVariants } from './toast';

export type ToastEntry = ToastPayload & {
  id: number;
  closing: boolean;
  mounted: boolean;
};

const AUTO_CLOSE_MS = 5000;

const VARIANT_STYLES: Record<ToastVariant, { icon: string; Icon: typeof Info; progress: string }> =
  {
    [ToastVariants.SUCCESS]: {
      icon: 'text-success',
      Icon: CheckCircle2,
      progress: 'bg-success/70',
    },
    [ToastVariants.ERROR]: {
      icon: 'text-destructive',
      Icon: XCircle,
      progress: 'bg-destructive/70',
    },
    [ToastVariants.INFO]: {
      icon: 'text-glass/80',
      Icon: Info,
      progress: 'bg-glass/40',
    },
    [ToastVariants.WARN]: {
      icon: 'text-warn',
      Icon: AlertTriangle,
      progress: 'bg-warn/70',
    },
  };

type ToastItemProps = {
  entry: ToastEntry;
  style: CSSProperties;
  paused: boolean;
  onClose: () => void;
  onHeight: (id: number, height: number) => void;
};

export const ToastItem = ({ entry, style, paused, onClose, onHeight }: ToastItemProps) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const { copy, copied } = useCopyText();
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(AUTO_CLOSE_MS);
  const startedAtRef = useRef(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    onHeight(entry.id, node.getBoundingClientRect().height);
    const observer = new ResizeObserver((records) => {
      const first = records[0];
      if (first) onHeight(entry.id, first.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry.id, onHeight]);

  // Auto-close with hover-pause: `remainingRef` carries the leftover budget so
  // re-entry doesn't restart the bar from full.
  useEffect(() => {
    if (entry.closing) return;
    if (paused) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        remainingRef.current = Math.max(
          0,
          remainingRef.current - (Date.now() - startedAtRef.current),
        );
      }
      return;
    }
    if (remainingRef.current <= 0) {
      onClose();
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(onClose, remainingRef.current);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        remainingRef.current = Math.max(
          0,
          remainingRef.current - (Date.now() - startedAtRef.current),
        );
      }
    };
  }, [paused, entry.closing, onClose]);

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copy(entry.message);
  };

  const handleDismiss = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose();
  };

  const styles = VARIANT_STYLES[entry.variant];
  const showCopy = entry.variant === ToastVariants.ERROR;

  return (
    <div
      ref={ref}
      role={entry.variant === ToastVariants.ERROR ? 'alert' : 'status'}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={style}
      className={cn(
        'pointer-events-auto absolute right-0 bottom-0 w-[360px] max-w-[92vw]',
        'transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-edge bg-card/85 shadow-2xl backdrop-blur-xl">
        <div className="flex items-start gap-3 py-3 pr-2 pl-3.5">
          <styles.Icon size={18} className={cn('mt-0.5 shrink-0', styles.icon)} />

          <p
            className={cn(
              'min-w-0 flex-1 text-sm leading-snug break-words whitespace-pre-wrap text-glass',
              expanded ? 'line-clamp-none' : 'line-clamp-2',
            )}
          >
            {entry.message}
          </p>

          <div className="-mt-1 flex shrink-0 items-center gap-0.5">
            {showCopy && (
              <button
                type="button"
                onClick={handleCopy}
                aria-label={t('toast.copyMessage')}
                title={t('toast.copyMessage')}
                className={cn(
                  'cursor-pointer rounded-md p-1 transition-colors hover:bg-ghost-hover hover:text-glass',
                  copied ? 'text-success' : 'text-glass/55',
                )}
              >
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={t('toast.dismiss')}
              className="cursor-pointer rounded-md p-1 text-glass/55 transition-colors hover:bg-ghost-hover hover:text-glass"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="absolute right-0 bottom-0 left-0 h-[2px] bg-glass/5">
          <div
            className={cn('h-full origin-left', styles.progress)}
            style={{
              animation: `toast-shrink ${AUTO_CLOSE_MS}ms linear forwards`,
              animationPlayState: paused || entry.closing ? 'paused' : 'running',
            }}
          />
        </div>
      </div>
    </div>
  );
};
