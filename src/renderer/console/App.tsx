import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import {
  type ConsoleInitialPayload,
  type ConsoleLine,
  type ConsoleProcessState,
  type ConsoleSource,
  ConsoleStatuses,
} from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

const BUFFER_LIMIT = 10000;
const SEARCH_RESULT_CAP = 5000;
const ROW_HEIGHT = 22;
const OVERSCAN = 16;
const SCROLL_BOTTOM_THRESHOLD = 24;
const SEARCH_DEBOUNCE_MS = 120;
const COPY_FEEDBACK_RESET_MS = 1500;

const TWO_DIGITS = 2;
const THREE_DIGITS = 3;
const pad = (value: number, width: number): string => `${value}`.padStart(width, '0');

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return (
    `${pad(date.getHours(), TWO_DIGITS)}:${pad(date.getMinutes(), TWO_DIGITS)}:` +
    `${pad(date.getSeconds(), TWO_DIGITS)}.${pad(date.getMilliseconds(), THREE_DIGITS)}`
  );
};

const sourceLabelKey = (source: ConsoleSource): string => `console.source.${source}`;

const findMatches = (lines: ConsoleLine[], query: string): number[] => {
  if (!query) return [];
  const needle = query.toLowerCase();
  const out: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line?.message.toLowerCase().includes(needle)) {
      out.push(index);
      if (out.length >= SEARCH_RESULT_CAP) break;
    }
  }
  return out;
};

type HighlightProps = {
  message: string;
  query: string;
  active: boolean;
};

const Highlight = ({ message, query, active }: HighlightProps): ReactNode => {
  if (!query) return message;
  const needle = query.toLowerCase();
  const haystack = message.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;
  while (cursor < message.length) {
    const next = haystack.indexOf(needle, cursor);
    if (next === -1) {
      parts.push(message.slice(cursor));
      break;
    }
    if (next > cursor) parts.push(message.slice(cursor, next));
    parts.push(
      <span
        key={`${next}-${matchIndex}`}
        className="console-highlight"
        data-active={active && matchIndex === 0 ? 'true' : undefined}
      >
        {message.slice(next, next + needle.length)}
      </span>,
    );
    cursor = next + needle.length;
    matchIndex++;
  }
  return parts;
};

const COPY_FEEDBACKS = {
  IDLE: 'idle',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;
type CopyFeedback = (typeof COPY_FEEDBACKS)[keyof typeof COPY_FEEDBACKS];

const statusToneClass = (status: ConsoleProcessState['status']): string => {
  switch (status) {
    case ConsoleStatuses.RUNNING:
      return 'border-success/40 text-success';
    case ConsoleStatuses.LAUNCHING:
      return 'border-edge-lg text-foreground';
    case ConsoleStatuses.CRASHED:
    case ConsoleStatuses.ERROR:
      return 'border-destructive/50 text-destructive';
    case ConsoleStatuses.EXITED:
      return 'border-edge-md text-foreground/60';
    default:
      return 'border-edge-md text-foreground/55';
  }
};

const INITIAL_STATE: ConsoleProcessState = {
  slug: '' as ClientSlug,
  status: ConsoleStatuses.IDLE,
};

export const ConsoleApp = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<ConsoleProcessState>(INITIAL_STATE);
  const [clientTitle, setClientTitle] = useState<string>('');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [copyAllFeedback, setCopyAllFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);
  const [copyLineFeedback, setCopyLineFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);

  const seenIdsRef = useRef<Set<number>>(new Set());
  const pendingRef = useRef<ConsoleLine[]>([]);
  const flushRafRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Mirror `paused` into a ref so the IPC listener doesn't have to be
   * resubscribed every time the user toggles pause. The listener is
   * registered once and reads the latest paused value through this ref —
   * avoids a strict-mode / pause-toggle gap where pushes between
   * cleanup and re-subscribe would be silently dropped by Electron.
   */
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const isAtBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const totalLines = lines.length;
  const matches = useMemo(() => findMatches(lines, searchQuery), [lines, searchQuery]);
  const activeMatchIndex = matches.length > 0 ? activeMatch % matches.length : 0;
  const activeRowIndex = matches.length > 0 ? (matches[activeMatchIndex] ?? null) : null;

  const isCrashed =
    state.status === ConsoleStatuses.CRASHED || state.status === ConsoleStatuses.ERROR;
  const exitCode = state.exitCode ?? null;

  // ── window title ─────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = t('console.windowTitle');
  }, [t]);

  // ── initial fetch ────────────────────────────────────────────────────────
  const refreshInitial = useCallback(() => {
    let cancelled = false;
    window.api
      .invoke(IPC_CHANNELS.consoleGetInitial, undefined)
      .then((payload: ConsoleInitialPayload) => {
        if (cancelled) return;
        if (payload.activeSession) {
          setClientTitle(payload.activeSession.clientTitle);
          setState(payload.activeSession.state);
        } else {
          setClientTitle('');
          setState(INITIAL_STATE);
        }
        setDroppedCount(payload.droppedCount);
        const seen = new Set<number>();
        for (const line of payload.lines) seen.add(line.id);
        seenIdsRef.current = seen;
        setLines(payload.lines);
      })
      .catch(() => {
        /* main may not be ready yet — live updates will catch us up */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshInitial(), [refreshInitial]);

  // ── live subscriptions ───────────────────────────────────────────────────
  /**
   * Mirror of the working elixir-app console: coalesce inbound push batches
   * via RAF so a burst of stdout lines turns into one `setLines` update.
   * The window is created with `backgroundThrottling: false` so RAF keeps
   * firing even when the console is occluded by Minecraft / launcher.
   */
  const flushPending = useCallback(() => {
    const incoming = pendingRef.current;
    if (incoming.length === 0) return;
    pendingRef.current = [];
    setLines((prev) => {
      const seen = seenIdsRef.current;
      const next = prev.slice();
      for (const line of incoming) {
        if (seen.has(line.id)) continue;
        seen.add(line.id);
        next.push(line);
      }
      if (next.length > BUFFER_LIMIT) {
        const overflow = next.length - BUFFER_LIMIT;
        for (let i = 0; i < overflow; i++) {
          const dropped = next[i];
          if (dropped) seen.delete(dropped.id);
        }
        next.splice(0, overflow);
        setDroppedCount((current) => current + overflow);
      }
      return next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null) return;
    // `requestAnimationFrame` is paused for occluded BrowserWindows even with
    // `backgroundThrottling: false`. `queueMicrotask` runs synchronously at
    // the end of the current task — never throttled, never paused — so the
    // flush completes regardless of window visibility.
    flushRafRef.current = 1;
    queueMicrotask(() => {
      flushRafRef.current = null;
      flushPending();
    });
  }, [flushPending]);

  useEffect(() => {
    const offLines = window.api.on(IPC_EVENTS.consoleLines, (incoming) => {
      if (pausedRef.current) {
        pendingRef.current.push(...incoming);
        if (pendingRef.current.length > BUFFER_LIMIT) {
          pendingRef.current.splice(0, pendingRef.current.length - BUFFER_LIMIT);
        }
        return;
      }
      pendingRef.current.push(...incoming);
      scheduleFlush();
    });
    const offState = window.api.on(IPC_EVENTS.consoleState, (event) => {
      setState(event);
      if (event.clientTitle !== undefined) setClientTitle(event.clientTitle);
    });
    const offReset = window.api.on(IPC_EVENTS.consoleBufferReset, () => {
      pendingRef.current = [];
      seenIdsRef.current = new Set();
      setSelectedId(null);
      refreshInitial();
    });
    return () => {
      offLines();
      offState();
      offReset();
      // Microtask flushes can't be cancelled; just clear the guard so a
      // late callback becomes a no-op (it reads empty pending).
      flushRafRef.current = null;
    };
  }, [scheduleFlush, refreshInitial]);

  useEffect(() => {
    if (!paused && pendingRef.current.length > 0) scheduleFlush();
  }, [paused, scheduleFlush]);

  /**
   * Background-safety reconciliation. Push delivery is fast but unreliable
   * in occluded BrowserWindows — Chromium can pause RAF / throttle timers
   * even with `backgroundThrottling: false` once the page has been hidden
   * long enough. A 1s `getInitial` poll re-syncs whatever the push channel
   * missed; `seenIdsRef` dedupes against what already arrived live so the
   * user sees each line exactly once, with at most 1s lag.
   */
  useEffect(() => {
    const handle = window.setInterval(() => {
      window.api
        .invoke(IPC_CHANNELS.consoleGetInitial, undefined)
        .then((payload: ConsoleInitialPayload) => {
          const session = payload.activeSession;
          if (session) {
            setClientTitle(session.clientTitle);
            setState((prev) =>
              prev.status === session.state.status && prev.exitCode === session.state.exitCode
                ? prev
                : session.state,
            );
          }
          setDroppedCount(payload.droppedCount);
          const seen = seenIdsRef.current;
          const fresh = payload.lines.filter((line) => !seen.has(line.id));
          if (fresh.length === 0) return;
          if (pausedRef.current) {
            pendingRef.current.push(...fresh);
            if (pendingRef.current.length > BUFFER_LIMIT) {
              pendingRef.current.splice(0, pendingRef.current.length - BUFFER_LIMIT);
            }
            return;
          }
          pendingRef.current.push(...fresh);
          scheduleFlush();
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(handle);
  }, [scheduleFlush]);

  // ── scroll tracking + auto-stick to bottom ───────────────────────────────
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const onScroll = () => {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      isAtBottomRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
      setShowJumpButton(!isAtBottomRef.current);
      setScrollTop(element.scrollTop);
    };
    const onResize = () => {
      setViewportHeight(element.clientHeight);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lines.length is the trigger; the body reads only refs
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    if (isAtBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [lines.length]);

  // ── debounced search input → live query ──────────────────────────────────
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput);
      setActiveMatch(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatch(0);
      return;
    }
    if (activeMatch >= matches.length) setActiveMatch(matches.length - 1);
  }, [matches.length, activeMatch]);

  const scrollToRow = useCallback((index: number) => {
    const element = bodyRef.current;
    if (!element) return;
    const target = index * ROW_HEIGHT;
    if (
      target < element.scrollTop ||
      target > element.scrollTop + element.clientHeight - ROW_HEIGHT
    ) {
      element.scrollTop = Math.max(0, target - element.clientHeight / 2 + ROW_HEIGHT / 2);
    }
  }, []);

  useEffect(() => {
    if (activeRowIndex == null) return;
    scrollToRow(activeRowIndex);
  }, [activeRowIndex, scrollToRow]);

  // ── controls ────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    void window.api.invoke(IPC_CHANNELS.consoleClear, undefined).catch(() => {});
    pendingRef.current = [];
    seenIdsRef.current = new Set();
    setLines([]);
    setDroppedCount(0);
    setSelectedId(null);
  }, []);

  const flashFeedback = useCallback((setter: (next: CopyFeedback) => void, kind: CopyFeedback) => {
    setter(kind);
    window.setTimeout(() => setter('idle'), COPY_FEEDBACK_RESET_MS);
  }, []);

  const handleCopyAll = useCallback(async () => {
    try {
      await window.api.invoke(IPC_CHANNELS.consoleCopyAll, undefined);
      flashFeedback(setCopyAllFeedback, COPY_FEEDBACKS.SUCCESS);
    } catch {
      flashFeedback(setCopyAllFeedback, COPY_FEEDBACKS.ERROR);
    }
  }, [flashFeedback]);

  const handleJumpToBottom = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    isAtBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  const goNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const goPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const handleTogglePause = useCallback(() => setPaused((value) => !value), []);

  const handleSearchClear = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setActiveMatch(0);
  }, []);

  const focusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.ctrlKey || event.metaKey;
      if (isMod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focusSearch();
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInSearch = target === searchInputRef.current;
      if (!isInSearch && event.key === 'Escape' && searchInput) {
        event.preventDefault();
        handleSearchClear();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusSearch, handleSearchClear, searchInput]);

  // ── virtualization slice ────────────────────────────────────────────────
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(totalLines, startIndex + visibleCount);
  const visibleLines = lines.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;
  const totalHeight = totalLines * ROW_HEIGHT;

  const selectedLine = useMemo(
    () => (selectedId == null ? null : (lines.find((line) => line.id === selectedId) ?? null)),
    [selectedId, lines],
  );

  const handleCopyLine = useCallback(async () => {
    if (!selectedLine) return;
    const text = selectedLine.code
      ? t(selectedLine.code, selectedLine.args ?? {})
      : selectedLine.message;
    try {
      await window.api.invoke(IPC_CHANNELS.consoleCopyText, text);
      flashFeedback(setCopyLineFeedback, COPY_FEEDBACKS.SUCCESS);
    } catch {
      flashFeedback(setCopyLineFeedback, COPY_FEEDBACKS.ERROR);
    }
  }, [selectedLine, t, flashFeedback]);

  const statusLabel = t(`console.status.${state.status}`);
  const headerSubtitle = clientTitle || '';

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="app-region-drag relative z-50 flex h-10 shrink-0 select-none items-center bg-transparent">
        <div className="title-bar-safe flex h-full w-full items-center border-b border-edge">
          <div className="app-region-no-drag flex h-full items-center gap-2.5 pl-4">
            <span className="flex h-4 w-4 items-center justify-center text-glass/55">
              <Terminal className="size-3.5" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-eyebrow text-glass/55">
              {t('console.header')}
            </span>
            {headerSubtitle && (
              <>
                <span className="h-3 w-px bg-edge-md" aria-hidden="true" />
                <span
                  className="max-w-[260px] truncate text-[12px] font-semibold text-glass/85"
                  title={headerSubtitle}
                >
                  {headerSubtitle}
                </span>
              </>
            )}
          </div>
          <div className="app-region-no-drag flex h-full items-center px-3">
            <span
              data-status={state.status}
              className={cn(
                'inline-flex h-5 items-center rounded-sm border px-2 text-[9.5px] font-bold uppercase tracking-wider',
                statusToneClass(state.status),
              )}
            >
              {statusLabel}
            </span>
          </div>
          <div className="flex-1" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2.5">
        <div className="relative flex items-center gap-1.5">
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-foreground/45"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('console.search')}
            aria-label={t('console.search')}
            className="h-8 w-64 px-8 text-xs"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleSearchClear}
              aria-label={t('console.searchClear')}
              className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-sm text-foreground/50 hover:bg-ghost-hover hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
          <span className="ml-1 min-w-[52px] text-center text-[10.5px] tabular-nums text-foreground/55">
            {searchQuery
              ? matches.length > 0
                ? t('console.matches', {
                    current: activeMatchIndex + 1,
                    total: matches.length,
                  })
                : t('console.noMatches')
              : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={goPrevMatch}
            disabled={matches.length === 0}
            aria-label={t('console.previousMatch')}
            className="h-7 w-7 px-0"
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNextMatch}
            disabled={matches.length === 0}
            aria-label={t('console.nextMatch')}
            className="h-7 w-7 px-0"
          >
            <ChevronDown className="size-3" />
          </Button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={handleTogglePause} aria-pressed={paused}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? t('console.resume') : t('console.pause')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="size-3.5" />
            {t('console.clear')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopyAll()}
            data-feedback={copyAllFeedback === COPY_FEEDBACKS.IDLE ? undefined : copyAllFeedback}
            className={cn(
              copyAllFeedback === COPY_FEEDBACKS.SUCCESS && 'border-success/40 text-success',
              copyAllFeedback === COPY_FEEDBACKS.ERROR && 'border-destructive/50 text-destructive',
            )}
          >
            <ClipboardCopy className="size-3.5" />
            {copyAllFeedback === COPY_FEEDBACKS.SUCCESS
              ? t('console.copied')
              : copyAllFeedback === COPY_FEEDBACKS.ERROR
                ? t('console.copyFailed')
                : t('console.copyAll')}
          </Button>
        </div>
      </div>

      {isCrashed && (
        <output className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
          <AlertTriangle size={14} aria-hidden="true" />
          <strong className="font-semibold">{statusLabel}</strong>
          <span className="text-foreground/70">{t('console.crashHint')}</span>
          {exitCode != null && (
            <span className="font-mono text-foreground/65">
              {t('console.exitCodeLabel', { exitCode })}
            </span>
          )}
          {state.message && (
            <span className="truncate text-foreground/65" title={state.message}>
              {state.message}
            </span>
          )}
        </output>
      )}

      {paused && (
        <div className="border-b border-edge bg-chip px-4 py-1.5 text-center text-[11px] text-foreground/65">
          {t('console.pausedBanner')}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={bodyRef}
          className="console-body console-mono absolute inset-0 overflow-auto bg-background text-[12.5px] leading-snug"
        >
          {droppedCount > 0 && (
            <div className="sticky top-0 z-10 border-b border-edge bg-chip-dark px-4 py-1 text-center text-[11px] text-foreground/55">
              {t('console.droppedHint', { count: droppedCount })}
            </div>
          )}
          {totalLines === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-foreground/40">
              {t('console.empty')}
            </div>
          )}
          <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleLines.map((line, index) => {
                const absoluteIndex = startIndex + index;
                const isActiveSearchRow =
                  activeRowIndex != null && activeRowIndex === absoluteIndex;
                const rowStyle: CSSProperties = { height: `${ROW_HEIGHT}px` };
                const messageNode = line.code ? (
                  t(line.code, line.args ?? {})
                ) : (
                  <Highlight
                    message={line.message}
                    query={searchQuery}
                    active={isActiveSearchRow}
                  />
                );
                return (
                  <button
                    key={line.id}
                    type="button"
                    className="console-row overflow-hidden whitespace-nowrap"
                    data-source={line.source}
                    data-level={line.level}
                    data-selected={selectedId === line.id ? 'true' : undefined}
                    data-active-match={isActiveSearchRow ? 'true' : undefined}
                    style={rowStyle}
                    onClick={() => setSelectedId(line.id)}
                  >
                    <span className="console-row-stripe" aria-hidden="true" />
                    <span className="console-time w-[88px] flex-none self-center pl-2 pr-2 text-[10.5px] text-foreground/45">
                      {formatTime(line.timestamp)}
                    </span>
                    <span className="console-source w-[44px] flex-none self-center pr-2 text-[9.5px] font-bold uppercase tracking-wider text-foreground/45">
                      {t(sourceLabelKey(line.source))}
                    </span>
                    <span className="console-message flex-1 self-center overflow-hidden text-ellipsis pr-3">
                      {messageNode}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {showJumpButton && (
          <Button
            type="button"
            size="sm"
            onClick={handleJumpToBottom}
            className="absolute bottom-3 right-4 z-10 rounded-full px-3"
          >
            <ArrowDown className="size-3.5" />
            {t('console.scrollToBottom')}
          </Button>
        )}
      </div>

      {selectedLine && (
        <div className="flex max-h-[30%] flex-col border-t border-edge bg-background">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2">
            <span className="text-[11px] font-bold uppercase tracking-eyebrow text-foreground/55">
              {t('console.detailHeader')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopyLine()}
                data-feedback={
                  copyLineFeedback === COPY_FEEDBACKS.IDLE ? undefined : copyLineFeedback
                }
                className={cn(
                  copyLineFeedback === COPY_FEEDBACKS.SUCCESS && 'border-success/40 text-success',
                  copyLineFeedback === COPY_FEEDBACKS.ERROR &&
                    'border-destructive/50 text-destructive',
                )}
              >
                <ClipboardCopy className="size-3.5" />
                {copyLineFeedback === COPY_FEEDBACKS.SUCCESS
                  ? t('console.copied')
                  : copyLineFeedback === COPY_FEEDBACKS.ERROR
                    ? t('console.copyFailed')
                    : t('console.copyLine')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                <X className="size-3.5" />
                {t('console.detailClose')}
              </Button>
            </div>
          </div>
          <pre className="console-mono selectable flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[12px] leading-snug">
            {selectedLine.code
              ? t(selectedLine.code, selectedLine.args ?? {})
              : selectedLine.message}
          </pre>
        </div>
      )}
    </div>
  );
};
