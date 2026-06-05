import { CONSOLE_BUFFER_LIMIT } from '@shared/constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleCrashBanner } from './ConsoleCrashBanner';
import { ConsoleDetailPanel } from './ConsoleDetailPanel';
import { ConsoleHeader } from './ConsoleHeader';
import { ConsoleLogBody } from './ConsoleLogBody';
import { ConsolePausedBanner } from './ConsolePausedBanner';
import { ConsoleToolbar } from './ConsoleToolbar';
import { copyAll, copyText } from './api';
import { CONSOLE_ROW_HEIGHT } from './constants';
import { COPY_FEEDBACKS, type CopyFeedback } from './format';
import { useConsoleScroll } from './hooks/useConsoleScroll';
import { useConsoleSearch } from './hooks/useConsoleSearch';
import { useConsoleStream } from './hooks/useConsoleStream';

const COPY_FEEDBACK_RESET_MS = 1500;

export const ConsoleApp = () => {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copyAllFeedback, setCopyAllFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);
  const [copyLineFeedback, setCopyLineFeedback] = useState<CopyFeedback>(COPY_FEEDBACKS.IDLE);
  const flashTimerRef = useRef<number | null>(null);

  const resetSelection = useCallback(() => setSelectedId(null), []);
  const stream = useConsoleStream(CONSOLE_BUFFER_LIMIT, resetSelection);
  const search = useConsoleSearch(stream.lines);
  const scroll = useConsoleScroll(stream.lines.length);

  useEffect(() => {
    document.title = t('console.windowTitle');
  }, [t]);

  useEffect(() => {
    if (search.activeRowIndex == null) return;
    scroll.scrollToRow(search.activeRowIndex, CONSOLE_ROW_HEIGHT);
  }, [search.activeRowIndex, scroll]);

  const handleClear = useCallback(() => {
    stream.clear();
  }, [stream]);

  const flashFeedback = useCallback((setter: (next: CopyFeedback) => void, kind: CopyFeedback) => {
    setter(kind);
    if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      setter(COPY_FEEDBACKS.IDLE);
    }, COPY_FEEDBACK_RESET_MS);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const handleCopyAll = useCallback(async () => {
    try {
      await copyAll();
      flashFeedback(setCopyAllFeedback, COPY_FEEDBACKS.SUCCESS);
    } catch {
      flashFeedback(setCopyAllFeedback, COPY_FEEDBACKS.ERROR);
    }
  }, [flashFeedback]);

  const selectedLine = useMemo(
    () =>
      selectedId == null ? null : (stream.lines.find((line) => line.id === selectedId) ?? null),
    [selectedId, stream.lines],
  );

  const selectedLineText = useMemo(() => {
    if (!selectedLine) return '';
    if (selectedLine.code) return t(selectedLine.code, selectedLine.args ?? {});
    return selectedLine.message;
  }, [selectedLine, t]);

  const handleCopyLine = useCallback(async () => {
    if (!selectedLine) return;
    try {
      await copyText(selectedLineText);
      flashFeedback(setCopyLineFeedback, COPY_FEEDBACKS.SUCCESS);
    } catch {
      flashFeedback(setCopyLineFeedback, COPY_FEEDBACKS.ERROR);
    }
  }, [selectedLine, selectedLineText, flashFeedback]);

  const statusLabel = t(`console.status.${stream.state.status}`);
  const headerSubtitle = stream.clientTitle || '';

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ConsoleHeader
        status={stream.state.status}
        statusLabel={statusLabel}
        headerSubtitle={headerSubtitle}
      />
      <ConsoleToolbar
        search={search}
        paused={stream.paused}
        copyAllFeedback={copyAllFeedback}
        onTogglePause={stream.togglePause}
        onClear={handleClear}
        onCopyAll={handleCopyAll}
      />
      <ConsoleCrashBanner state={stream.state} statusLabel={statusLabel} />
      {stream.paused && <ConsolePausedBanner />}
      <ConsoleLogBody
        lines={stream.lines}
        droppedCount={stream.droppedCount}
        selectedId={selectedId}
        search={search}
        scroll={scroll}
        onSelectLine={setSelectedId}
      />
      {selectedLine && (
        <ConsoleDetailPanel
          lineText={selectedLineText}
          copyLineFeedback={copyLineFeedback}
          onCopyLine={handleCopyLine}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
};
