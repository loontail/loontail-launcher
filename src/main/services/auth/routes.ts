import { isErrorCode } from '@loontail/minecraft-kit';
import { setStoredAuth } from '@main/infra/store';
import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  LoginPayloadSchema,
  type LoginResult,
  RegisterPayloadSchema,
} from '@shared/contracts/auth';
import { IPC_CHANNELS } from '@shared/ipc';
import { buildLoginResult, fetchCurrentUser, login, logout, register } from './auth';
import type { LoontailAuth } from './loontailAuth';
import { type MojangAuth, MojangBrowserOpenError } from './mojangAuth';
import type { SessionRefresher } from './sessionRefresh';
import type { FetchTextures } from './yggdrasilClient';

// User-cancel gets its own `Cancelled` code so the renderer can suppress it.
// Network failures surface as `TypeError: fetch failed` from undici and map to a
// distinct code so the UI can prompt about connectivity.
const mojangFailureCode = (error: unknown): LoginErrorCode => {
  if (error instanceof MojangBrowserOpenError) return LOGIN_ERROR_CODE.BrowserOpenFailed;
  if (isErrorCode(error, 'AUTH_CANCELLED')) return LOGIN_ERROR_CODE.Cancelled;
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NetworkError;
  return LOGIN_ERROR_CODE.Unknown;
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

  router.handle(IPC_CHANNELS.authMe, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.me takes no arguments');
    return fetchCurrentUser(refresher, mojangAuth, fetchTextures);
  });

  router.handle(IPC_CHANNELS.authLogout, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.logout takes no arguments');
    return logout(loontailAuth);
  });

  router.handle(IPC_CHANNELS.authMojangSignIn, async (rawArgs): Promise<LoginResult> => {
    assertNoIpcArgs(rawArgs, 'auth.mojang.signIn takes no arguments');
    try {
      const session = await mojangAuth.signInWithMojang();
      setStoredAuth(session);
      return buildLoginResult(session, fetchTextures);
    } catch (error) {
      return { ok: false, error: mojangFailureCode(error) };
    }
  });

  router.handle(IPC_CHANNELS.authMojangCancel, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.mojang.cancel takes no arguments');
    mojangAuth.cancelMojangLogin();
  });
};
