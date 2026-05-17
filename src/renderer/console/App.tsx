import type { Translator } from '@renderer/i18n';
import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import {
  type ConsoleProcessState,
  type ConsoleSource,
  ConsoleStatuses,
} from '@shared/contracts/console';
import { IPC_CHANNELS } from '@shared/ipc';
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
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useConsoleScroll } from './hooks/useConsoleScroll';
import { type ConsoleSearchApi, useConsoleSearch } from './hooks/useConsoleSearch';
import { useConsoleStream } from './hooks/useConsoleStream';

const renderSearchCounter = (search: ConsoleSearchApi, t: Translator): string => {
  if (!search.searchQuery) return '';
  if (search.matches.length === 0) return t('console.noMatches');
  return t('console.matches', {
    current: search.activeMatchIndex + 1,
    total: search.matches.length,
  });
};

const BUFFER_LIMIT = 10000;
const ROW_HEIGHT = 22;
const OVERSCAN = 16;
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

const copyFeedbackLabel = (feedback: CopyFeedback, idleLabel: string, t: Translator): string => {
  if (feedback === COPY_FEEDBACKS.SUCCESS) return t('console.copied');
  if (feedback === COPY_FEEDBACKS.ERROR) return t('console.copyFailed');
  return idleLabel;
};

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

export const ConsoleApp = () => {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copyAllFeedback, setCopyAllFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);
  const [copyLineFeedback, setCopyLineFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);

  const resetSelection = useCallback(() => setSelectedId(null), []);
  const stream = useConsoleStream(BUFFER_LIMIT, resetSelection);
  const search = useConsoleSearch(stream.lines);
  const scroll = useConsoleScroll(stream.lines.length);

  const isCrashed =
    stream.state.status === ConsoleStatuses.CRASHED ||
    stream.state.status === ConsoleStatuses.ERROR;
  const exitCode = stream.state.exitCode ?? null;

  useEffect(() => {
    document.title = t('console.windowTitle');
  }, [t]);

  useEffect(() => {
    if (search.activeRowIndex == null) return;
    scroll.scrollToRow(search.activeRowIndex, ROW_HEIGHT);
  }, [search.activeRowIndex, scroll]);

  const handleClear = useCallback(() => {
    stream.clear();
  }, [stream]);

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

  const startIndex = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(scroll.viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const totalLines = stream.lines.length;
  const endIndex = Math.min(totalLines, startIndex + visibleCount);
  const visibleLines = stream.lines.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;
  const totalHeight = totalLines * ROW_HEIGHT;

  const selectedLine = useMemo(
    () =>
      selectedId == null ? null : (stream.lines.find((line) => line.id === selectedId) ?? null),
    [selectedId, stream.lines],
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

  const statusLabel = t(`console.status.${stream.state.status}`);
  const headerSubtitle = stream.clientTitle || '';

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
              data-status={stream.state.status}
              className={cn(
                'inline-flex h-5 items-center rounded-sm border px-2 text-[9.5px] font-bold uppercase tracking-wider',
                statusToneClass(stream.state.status),
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
            ref={search.searchInputRef}
            value={search.searchInput}
            onChange={(event) => search.setSearchInput(event.target.value)}
            placeholder={t('console.search')}
            aria-label={t('console.search')}
            className="h-8 w-64 px-8 text-xs"
          />
          {search.searchInput && (
            <button
              type="button"
              onClick={search.clear}
              aria-label={t('console.searchClear')}
              className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-sm text-foreground/50 hover:bg-ghost-hover hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
          <span className="ml-1 min-w-[52px] text-center text-[10.5px] tabular-nums text-foreground/55">
            {renderSearchCounter(search, t)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={search.goPrevMatch}
            disabled={search.matches.length === 0}
            aria-label={t('console.previousMatch')}
            className="h-7 w-7 px-0"
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={search.goNextMatch}
            disabled={search.matches.length === 0}
            aria-label={t('console.nextMatch')}
            className="h-7 w-7 px-0"
          >
            <ChevronDown className="size-3" />
          </Button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={stream.togglePause}
            aria-pressed={stream.paused}
          >
            {stream.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {stream.paused ? t('console.resume') : t('console.pause')}
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
            {copyFeedbackLabel(copyAllFeedback, t('console.copyAll'), t)}
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
          {stream.state.message && (
            <span className="truncate text-foreground/65" title={stream.state.message}>
              {stream.state.message}
            </span>
          )}
        </output>
      )}

      {stream.paused && (
        <div className="border-b border-edge bg-chip px-4 py-1.5 text-center text-[11px] text-foreground/65">
          {t('console.pausedBanner')}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scroll.bodyRef}
          className="console-body console-mono absolute inset-0 overflow-auto bg-background text-[12.5px] leading-snug"
        >
          {stream.droppedCount > 0 && (
            <div className="sticky top-0 z-10 border-b border-edge bg-chip-dark px-4 py-1 text-center text-[11px] text-foreground/55">
              {t('console.droppedHint', { count: stream.droppedCount })}
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
                  search.activeRowIndex != null && search.activeRowIndex === absoluteIndex;
                const rowStyle: CSSProperties = { height: `${ROW_HEIGHT}px` };
                const messageNode = line.code ? (
                  t(line.code, line.args ?? {})
                ) : (
                  <Highlight
                    message={line.message}
                    query={search.searchQuery}
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
        {scroll.showJumpButton && (
          <Button
            type="button"
            size="sm"
            onClick={scroll.jumpToBottom}
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
                {copyFeedbackLabel(copyLineFeedback, t('console.copyLine'), t)}
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
