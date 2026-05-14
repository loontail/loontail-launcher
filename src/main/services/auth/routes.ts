import type { Router } from '@main/ipc/router';
import { ERROR_CODES } from '@shared/constants';
import { LoginPayloadSchema } from '@shared/contracts';
import { IPC_CHANNELS } from '@shared/ipc';
import { fetchCurrentUser, login, logout } from './auth';

export const registerAuthRoutes = (router: Router): void => {
  router.handle(IPC_CHANNELS.authLogin, async (rawArgs) => {
    const parsed = LoginPayloadSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.IpcInvalidArgs,
        message: 'Invalid login payload',
        details: parsed.error.format(),
      };
    }
    return login(parsed.data);
  });

  router.handle(IPC_CHANNELS.authMe, () => fetchCurrentUser());

  router.handle(IPC_CHANNELS.authLogout, () => {
    logout();
  });
};
