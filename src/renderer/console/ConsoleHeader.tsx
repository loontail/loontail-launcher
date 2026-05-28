import { cn } from '@renderer/shared/lib/cn';
import type { ConsoleProcessStatus } from '@shared/contracts/console';
import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { statusToneClass } from './format';

type ConsoleHeaderProps = {
  status: ConsoleProcessStatus;
  statusLabel: string;
  headerSubtitle: string;
};

export const ConsoleHeader = ({ status, statusLabel, headerSubtitle }: ConsoleHeaderProps) => {
  const { t } = useTranslation();

  return (
    <header className="app-region-drag relative z-50 flex h-10 shrink-0 select-none items-center bg-transparent">
      <div className="title-bar-safe flex h-full w-full items-center border-b border-edge">
        <div className="app-region-no-drag flex h-full items-center gap-2.5 pl-4">
          <span className="flex h-4 w-4 items-center justify-center text-glass/55">
            <Terminal className="size-3.5" />
          </span>
          <span className="text-eyebrow font-bold uppercase tracking-eyebrow text-glass/55">
            {t('console.header')}
          </span>
          {headerSubtitle && (
            <>
              <span className="h-3 w-px bg-edge-md" aria-hidden="true" />
              <span
                className="max-w-[260px] truncate text-caption font-semibold text-glass/85"
                title={headerSubtitle}
              >
                {headerSubtitle}
              </span>
            </>
          )}
        </div>
        <div className="app-region-no-drag flex h-full items-center px-3">
          <span
            data-status={status}
            className={cn(
              'inline-flex h-5 items-center rounded-sm border px-2 text-[9.5px] font-bold uppercase tracking-wider',
              statusToneClass(status),
            )}
          >
            {statusLabel}
          </span>
        </div>
        <div className="flex-1" />
      </div>
    </header>
  );
};
