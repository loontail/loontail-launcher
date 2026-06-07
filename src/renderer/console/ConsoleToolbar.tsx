import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  COPY_FEEDBACKS,
  type CopyFeedback,
  copyFeedbackLabel,
  formatSearchCounter,
} from './format';
import type { ConsoleSearchApi } from './hooks/useConsoleSearch';

type ConsoleToolbarProps = {
  search: ConsoleSearchApi;
  paused: boolean;
  copyAllFeedback: CopyFeedback;
  onTogglePause: () => void;
  onClear: () => void;
  onCopyAll: () => Promise<void>;
};

export const ConsoleToolbar = ({
  search,
  paused,
  copyAllFeedback,
  onTogglePause,
  onClear,
  onCopyAll,
}: ConsoleToolbarProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-0/60 px-4 py-2.5">
      <div className="relative flex items-center gap-1.5">
        <Search
          className="pointer-events-none absolute left-2.5 size-3.5 text-glass/45"
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
            className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-sm text-glass/50 hover:bg-ghost-hover hover:text-glass"
          >
            <X className="size-3" />
          </button>
        )}
        <span className="ml-1 min-w-(--console-counter-min) text-center text-console-meta tabular-nums text-glass/55">
          {formatSearchCounter(
            search.searchQuery,
            search.matches.length,
            search.activeMatchIndex,
            t,
          )}
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
        <Button variant="outline" size="sm" onClick={onTogglePause} aria-pressed={paused}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? t('console.resume') : t('console.pause')}
        </Button>
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="size-3.5" />
          {t('console.clear')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onCopyAll()}
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
  );
};
