import { AppBar } from '@renderer/features/app-bar';
import { IPC_CHANNELS } from '@shared/ipc';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const hasCustomTitleBar = window.api.platform !== 'linux';

export const App = (): ReactElement => {
  const versionQuery = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.api.invoke(IPC_CHANNELS.appGetVersion, undefined),
  });

  return (
    <div className="flex h-full flex-col">
      {hasCustomTitleBar && <AppBar />}
      <main className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-bold">Loontail Minecraft Launcher</h1>
          <p className="text-muted-foreground">
            {versionQuery.isPending ? 'Loading…' : `version ${versionQuery.data ?? 'unknown'}`}
          </p>
        </div>
      </main>
    </div>
  );
};
