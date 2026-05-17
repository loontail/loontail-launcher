import { UpdaterBadge } from '@renderer/features/updater';
import type { ReactNode } from 'react';

const APP_BRAND = 'Loontail Launcher';
const APP_STAGE_BADGE = 'Alpha';

type AppBarProps = {
  actions?: ReactNode;
};

export const AppBar = ({ actions }: AppBarProps) => (
  <header className="app-region-drag relative z-50 flex h-10 shrink-0 select-none items-center bg-transparent">
    <div className="title-bar-safe flex h-full w-full items-center">
      {/* Leading brand block — no-drag so the badges remain interactive */}
      <div className="app-region-no-drag flex h-full items-center gap-2.5 pl-4">
        <span className="flex h-4 w-4 items-center justify-center">
          <span className="h-2 w-2 rotate-45 rounded-xs bg-glass/80 shadow-[0_0_8px_var(--color-glow-glass)]" />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-eyebrow text-glass/55">
          {APP_BRAND}
        </span>
        <span className="cursor-default rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-glass/30 ring-1 ring-glass/15 transition-colors hover:text-glass/50 hover:ring-glass/30">
          {APP_STAGE_BADGE}
        </span>
        <UpdaterBadge />
      </div>

      <div className="flex-1" />

      {actions !== undefined && (
        <div className="app-region-no-drag flex h-full items-center">{actions}</div>
      )}
    </div>
  </header>
);
