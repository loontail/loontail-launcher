import { getLastPlayed } from '@main/infra/store';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';

export const registerHistoryRoutes = (router: Router): void => {
  router.handleNoArgs(IPC_CHANNELS.historyLastPlayed, () => {
    return getLastPlayed();
  });
};
