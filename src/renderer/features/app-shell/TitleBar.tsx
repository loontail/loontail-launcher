import { UpdaterBadge } from '@renderer/features/updater';
import { cn } from '@renderer/shared/lib/cn';
import { useWindowFocused } from '@renderer/shared/lib/useWindowFocused';
import { useTranslation } from 'react-i18next';

const APP_BRAND = 'Loontail Launcher';

export const TitleBar = () => {
  const { t } = useTranslation();
  const focused = useWindowFocused();

  return (
    <header className="app-region-drag relative z-50 flex h-12 shrink-0 select-none items-center bg-transparent">
      <div className="title-bar-safe flex h-full w-full items-center">
        <div
          className={cn(
            'app-region-no-drag flex h-full items-center gap-2.5 pl-4 transition-opacity ease-standard',
            focused ? 'opacity-100' : 'opacity-40',
          )}
        >
          <span className="flex h-4 w-4 items-center justify-center">
            <span className="h-2 w-2 rotate-45 rounded-xs bg-glass/80 shadow-[0_0_8px_var(--color-glow-glass)]" />
          </span>
          <span className="text-eyebrow font-bold uppercase tracking-eyebrow text-glass/55">
            {APP_BRAND}
          </span>
          <span className="group relative inline-flex">
            <span className="cursor-default rounded px-1 py-0.5 text-microlabel font-bold uppercase tracking-wider text-glass/30 ring-1 ring-edge-md transition-colors group-hover:text-glass/50 group-hover:ring-edge-lg">
              {t('appBar.alphaTag')}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-70 -translate-x-1/2 whitespace-normal rounded-md bg-surface-2 px-3 py-2 text-eyebrow font-medium leading-snug text-text-hi opacity-0 shadow-overlay ring-1 ring-edge-md transition-opacity duration-150 group-hover:opacity-100"
            >
              {t('appBar.alphaTooltip')}
            </span>
          </span>
        </div>

        <div className="flex-1" />

        <div className="app-region-no-drag flex h-full items-center gap-2 pr-2">
          <UpdaterBadge />
        </div>
      </div>
    </header>
  );
};
