import type { ReactElement } from 'react';

const APP_TITLE = 'Loontail Minecraft Launcher';

export const AppBar = (): ReactElement => (
  <header className="app-region-drag flex h-10 shrink-0 select-none items-center bg-background">
    <div className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
      <span>{APP_TITLE}</span>
    </div>
  </header>
);
