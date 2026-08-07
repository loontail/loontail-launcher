import { isErrorCode } from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { setStoredAuth } from '@main/infra/store';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import type { Account } from '@shared/contracts/account';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  LoginPayloadSchema,
  RegisterPayloadSchema,
} from '@shared/contracts/auth';
import { IPC_CHANNELS } from '@shared/ipc';
import { buildAccount, fetchCurrentUser, login, logout, register } from './auth';
import { AuthError } from './errors';
import type { LoontailAuth } from './loontailAuth';
import { type MojangAuth, MojangBrowserOpenError } from './mojangAuth';
import type { SessionRefresher } from './sessionRefresh';
import type { FetchTextures } from './yggdrasilClient';

// User-cancel gets its own `Cancelled` code so the renderer can suppress it.
// Network failures surface as `TypeError: fetch failed` from undici and map to a
// distinct code so the UI can prompt about connectivity.
const mojangFailureCode = (error: unknown): LoginErrorCode => {
  if (error instanceof MojangBrowserOpenError) return LOGIN_ERROR_CODE.BROWSER_OPEN_FAILED;
  if (isErrorCode(error, 'AUTH_CANCELLED')) return LOGIN_ERROR_CODE.CANCELLED;
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NETWORK_ERROR;
  return LOGIN_ERROR_CODE.UNKNOWN;
};

export const registerAuthRoutes = (
  router: Router,
  loontailAuth: LoontailAuth,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
  refresher: SessionRefresher,
): void => {
  router.handle(IPC_CHANNELS.authLogin, async (rawArgs) => {
    const payload = parseIpcArgs(LoginPayloadSchema, rawArgs, 'Invalid login payload');
    return login(loontailAuth, payload, fetchTextures);
  });

  router.handle(IPC_CHANNELS.authRegister, async (rawArgs) => {
    const payload = parseIpcArgs(RegisterPayloadSchema, rawArgs, 'Invalid register payload');
    return register(loontailAuth, payload, fetchTextures);
  });

  router.handleNoArgs(IPC_CHANNELS.authMe, () => {
    return fetchCurrentUser(refresher, loontailAuth.validate, mojangAuth, fetchTextures);
  });

  router.handleNoArgs(IPC_CHANNELS.authLogout, () => {
    return logout(loontailAuth);
  });

  router.handleNoArgs(IPC_CHANNELS.authMojangSignIn, async (): Promise<Account> => {
    try {
      const session = await mojangAuth.signInWithMojang();
      setStoredAuth(session);
      return await buildAccount(session, fetchTextures);
    } catch (error) {
      throw new AuthError(mojangFailureCode(error), errorMessage(error));
    }
  });

  router.handleNoArgs(IPC_CHANNELS.authMojangCancel, () => {
    mojangAuth.cancelMojangLogin();
  });
};
