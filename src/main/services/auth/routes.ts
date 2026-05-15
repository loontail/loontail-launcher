import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { LoginPayloadSchema } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';
import { fetchCurrentUser, login, logout } from './auth';

export const registerAuthRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.authLogin, async (rawArgs) => {
    const payload = parseIpcArgs(LoginPayloadSchema, rawArgs, 'Invalid login payload');
    return login(payload);
  });

  router.handle(IPC_CHANNELS.authMe, () => fetchCurrentUser());

  router.handle(IPC_CHANNELS.authLogout, () => {
    logout();
  });
};
