import type { ReactNode } from 'react';

const APP_TITLE = 'Loontail Minecraft Launcher';

type AppBarProps = {
  actions?: ReactNode;
};

export const AppBar = ({ actions }: AppBarProps) => (
  <header className="app-region-drag flex h-10 shrink-0 select-none bg-background">
    <div className="title-bar-safe flex h-full w-full items-stretch">
      <div className="flex flex-1 items-center px-3 text-xs text-muted-foreground">
        <span>{APP_TITLE}</span>
      </div>
      {actions !== undefined && (
        <div className="app-region-no-drag flex items-stretch">{actions}</div>
      )}
    </div>
  </header>
);
