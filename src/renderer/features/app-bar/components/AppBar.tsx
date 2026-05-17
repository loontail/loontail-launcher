import { UpdaterBadge } from '@renderer/features/updater';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const APP_BRAND = 'Loontail Launcher';

type AppBarProps = {
  actions?: ReactNode;
};

export const AppBar = ({ actions }: AppBarProps) => {
  const { t } = useTranslation();
  return (
    <header className="app-region-drag relative z-50 flex h-10 shrink-0 select-none items-center bg-transparent">
      <div className="title-bar-safe flex h-full w-full items-center">
        <div className="app-region-no-drag flex h-full items-center gap-2.5 pl-4">
          <span className="flex h-4 w-4 items-center justify-center">
            <span className="h-2 w-2 rotate-45 rounded-xs bg-glass/80 shadow-[0_0_8px_var(--color-glow-glass)]" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-eyebrow text-glass/55">
            {APP_BRAND}
          </span>
          <span className="group relative inline-flex">
            <span className="cursor-default rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-glass/30 ring-1 ring-glass/15 transition-colors group-hover:text-glass/50 group-hover:ring-glass/30">
              {t('appBar.alphaTag')}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-[280px] -translate-x-1/2 whitespace-normal rounded-md bg-popover px-3 py-2 text-[11px] font-medium leading-snug text-popover-foreground opacity-0 shadow-md ring-1 ring-edge-md transition-opacity duration-150 group-hover:opacity-100"
            >
              {t('appBar.alphaTooltip')}
            </span>
          </span>
        </div>

        <div className="flex-1" />

        <div className="app-region-no-drag flex h-full items-center gap-2 pr-2">
          <UpdaterBadge />
          {actions !== undefined && <div className="flex h-full items-center">{actions}</div>}
        </div>
      </div>
    </header>
  );
};
