import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { app } from 'electron';

export const registerAppRoutes = (router: Router): void => {
  router.handleNoArgs(IPC_CHANNELS.appGetVersion, () => {
    return app.getVersion();
  });
};
