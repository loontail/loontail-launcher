import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { getAppVersion } from './app';

export const registerAppRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.appGetVersion, () => getAppVersion());
};
