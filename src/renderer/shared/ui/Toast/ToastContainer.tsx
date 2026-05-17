import { cn } from '@renderer/shared/lib/cn';
import { AlertTriangle, CheckCircle2, Copy, Info, X, XCircle } from 'lucide-react';
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type ToastPayload, type ToastVariant, ToastVariants, subscribeToToasts } from './toast';

type ToastEntry = ToastPayload & {
  id: number;
  closing: boolean;
  mounted: boolean;
};

const AUTO_CLOSE_MS = 5000;
const EXIT_ANIM_MS = 260;
const STACK_PEEK_Y = 8;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.25;
const STACK_VISIBLE = 3;
const GAP = 10;
const COPY_RESET_MS = 1500;

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

const ToastItem = ({ entry, style, paused, onClose, onHeight }: ToastItemProps) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(AUTO_CLOSE_MS);
  const startedAtRef = useRef(0);
  const copyResetRef = useRef<number | null>(null);

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

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    },
    [],
  );

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(entry.message);
      setCopied(true);
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      /* clipboard may be unavailable (permission/focus); ignore quietly */
    }
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
                onClick={(event) => void handleCopy(event)}
                aria-label={t('toast.copyMessage')}
                className="cursor-pointer rounded-md p-1 text-glass/55 transition-colors hover:bg-ghost-hover hover:text-glass"
              >
                {copied ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
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

export const ToastContainer = () => {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const [hovered, setHovered] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const idRef = useRef(0);

  useEffect(
    () =>
      subscribeToToasts((payload) => {
        idRef.current += 1;
        const id = idRef.current;
        setEntries((prev) => [...prev, { ...payload, id, closing: false, mounted: false }]);
        // Two RAFs: first paints the toast off-screen at translateX(100%);
        // the second flips `mounted` so the transition runs to the rest pose.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setEntries((prev) =>
              prev.map((entry) => (entry.id === id ? { ...entry, mounted: true } : entry)),
            );
          });
        });
      }),
    [],
  );

  const dismiss = useCallback((id: number) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry)),
    );
    window.setTimeout(() => {
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      setHeights((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, EXIT_ANIM_MS);
  }, []);

  const setHeight = useCallback((id: number, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  if (entries.length === 0) return null;

  // Newest first → sits at the bottom of the visual stack (anchored bottom-right).
  const ordered = [...entries].reverse();
  const heightOf = (id: number) => heights[id] ?? 0;
  const front = ordered[0];
  if (!front) return null;

  const frontHeight = heightOf(front.id);
  const stackHeight = frontHeight + Math.min(ordered.length - 1, STACK_VISIBLE - 1) * STACK_PEEK_Y;
  const expandedHeight = ordered.reduce(
    (acc, entry, idx) => acc + heightOf(entry.id) + (idx > 0 ? GAP : 0),
    0,
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ height: hovered ? expandedHeight : stackHeight }}
      className="pointer-events-none fixed right-4 bottom-4 z-[60] w-[360px] max-w-[92vw] transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
    >
      {ordered.map((entry, idx) => {
        const offsetWhenFanned = ordered
          .slice(0, idx)
          .reduce((sum, prev) => sum + heightOf(prev.id) + GAP, 0);

        let translateX: string;
        let translateY: number;
        let scale: number;
        let opacity: number;

        if (!entry.mounted || entry.closing) {
          translateX = 'calc(100% + 1.5rem)';
          translateY = hovered ? -offsetWhenFanned : -idx * STACK_PEEK_Y;
          scale = hovered ? 1 : 1 - idx * STACK_SCALE_STEP;
          opacity = 0;
        } else if (hovered) {
          translateX = '0px';
          translateY = -offsetWhenFanned;
          scale = 1;
          opacity = 1;
        } else {
          translateX = '0px';
          translateY = -idx * STACK_PEEK_Y;
          scale = 1 - idx * STACK_SCALE_STEP;
          opacity = idx >= STACK_VISIBLE ? 0 : Math.max(0, 1 - idx * STACK_OPACITY_STEP);
        }

        return (
          <ToastItem
            key={entry.id}
            entry={entry}
            paused={hovered || entry.closing}
            onClose={() => dismiss(entry.id)}
            onHeight={setHeight}
            style={{
              transform: `translate3d(${translateX}, ${translateY}px, 0) scale(${scale})`,
              transformOrigin: 'right bottom',
              opacity,
              zIndex: 100 - idx,
              pointerEvents: !hovered && idx > 0 ? 'none' : undefined,
            }}
          />
        );
      })}
    </div>
  );
};
