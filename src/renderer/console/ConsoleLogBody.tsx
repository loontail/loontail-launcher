import { Button } from '@renderer/shared/ui/Button';
import type { ConsoleLine } from '@shared/contracts/console';
import { ArrowDown } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CONSOLE_ROW_HEIGHT, OVERSCAN } from './constants';
import { formatTime, Highlight, sourceLabelKey } from './format';
import type { ConsoleScrollApi } from './hooks/useConsoleScroll';
import type { ConsoleSearchApi } from './hooks/useConsoleSearch';

type ConsoleLogBodyProps = {
  lines: ConsoleLine[];
  droppedCount: number;
  selectedId: number | null;
  search: ConsoleSearchApi;
  scroll: ConsoleScrollApi;
  onSelectLine: (id: number) => void;
};

export const ConsoleLogBody = ({
  lines,
  droppedCount,
  selectedId,
  search,
  scroll,
  onSelectLine,
}: ConsoleLogBodyProps) => {
  const { t } = useTranslation();
  const startIndex = Math.max(0, Math.floor(scroll.scrollTop / CONSOLE_ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(scroll.viewportHeight / CONSOLE_ROW_HEIGHT) + OVERSCAN * 2;
  const totalLines = lines.length;
  const endIndex = Math.min(totalLines, startIndex + visibleCount);
  const visibleLines = lines.slice(startIndex, endIndex);
  const offsetY = startIndex * CONSOLE_ROW_HEIGHT;
  const totalHeight = totalLines * CONSOLE_ROW_HEIGHT;

  return (
    <div className="relative flex flex-1 flex-col min-h-0">
      {droppedCount > 0 && (
        <div className="z-10 border-b border-edge bg-chip-dark px-4 py-1 text-center text-eyebrow text-glass/55">
          {t('console.droppedHint', { count: droppedCount })}
        </div>
      )}
      <div
        ref={scroll.bodyRef}
        className="console-body console-mono relative flex-1 overflow-auto bg-canvas text-console-body leading-snug"
      >
        {totalLines === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-caption text-glass/40">
            {t('console.empty')}
          </div>
        )}
        <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleLines.map((line, index) => {
              const absoluteIndex = startIndex + index;
              const isActiveSearchRow =
                search.activeRowIndex != null && search.activeRowIndex === absoluteIndex;
              const rowStyle: CSSProperties = { height: `${CONSOLE_ROW_HEIGHT}px` };
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
                  onClick={() => onSelectLine(line.id)}
                >
                  <span className="console-row-stripe" aria-hidden="true" />
                  <span className="console-time w-(--console-time-width) flex-none self-center pl-2 pr-2 text-console-meta text-text-hi/45">
                    {formatTime(line.timestamp)}
                  </span>
                  <span className="console-source w-(--console-source-width) flex-none self-center pr-2 text-console-badge font-bold uppercase tracking-wider text-text-hi/45">
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
  );
};
