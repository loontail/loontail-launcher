import { assertNoIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { getLastPlayedMap } from './history';

export const registerHistoryRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.historyLastPlayed, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'history.lastPlayed takes no arguments');
    return getLastPlayedMap();
  });
};
