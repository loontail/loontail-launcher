import { isErrorCode } from '@loontail/minecraft-kit';
import { setStoredAuth } from '@main/infra/store';
import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { accountFromSession } from '@shared/contracts/account';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  LoginPayloadSchema,
  type LoginResult,
} from '@shared/contracts/auth';
import { IPC_CHANNELS } from '@shared/ipc';
import { fetchCurrentUser, login, logout } from './auth';
import { type MojangAuth, MojangBrowserOpenError } from './mojangAuth';
import type { YggdrasilAuth } from './yggdrasilAuth';

// Map a kit-side sign-in failure to the renderer's `LoginErrorCode`. The
// renderer's own `cancelledRef` already suppresses the user-cancel case, so we
// fall through to `Unknown` for the underlying `AUTH_CANCELLED`. Network errors
// surface as `TypeError: fetch failed` from undici — those deserve a distinct
// code so the UI prompts the user to check connectivity.
const mojangFailureCode = (error: unknown): LoginErrorCode => {
  if (error instanceof MojangBrowserOpenError) return LOGIN_ERROR_CODE.BrowserOpenFailed;
  if (isErrorCode(error, 'AUTH_CANCELLED')) return LOGIN_ERROR_CODE.Unknown;
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NetworkError;
  return LOGIN_ERROR_CODE.Unknown;
};

export const registerAuthRoutes = (
  router: Router,
  yggdrasilAuth: YggdrasilAuth,
  mojangAuth: MojangAuth,
): void => {
  router.handle(IPC_CHANNELS.authLogin, async (rawArgs) => {
    const payload = parseIpcArgs(LoginPayloadSchema, rawArgs, 'Invalid login payload');
    return login(yggdrasilAuth, payload);
  });

  router.handle(IPC_CHANNELS.authMe, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.me takes no arguments');
    return fetchCurrentUser(yggdrasilAuth, mojangAuth);
  });

  router.handle(IPC_CHANNELS.authLogout, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.logout takes no arguments');
    return logout(yggdrasilAuth);
  });

  router.handle(IPC_CHANNELS.authMojangSignIn, async (rawArgs): Promise<LoginResult> => {
    assertNoIpcArgs(rawArgs, 'auth.mojang.signIn takes no arguments');
    try {
      const session = await mojangAuth.signInWithMojang();
      setStoredAuth(session);
      return { ok: true, user: accountFromSession(session) };
    } catch (error) {
      return { ok: false, error: mojangFailureCode(error) };
    }
  });

  router.handle(IPC_CHANNELS.authMojangCancel, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'auth.mojang.cancel takes no arguments');
    mojangAuth.cancelMojangLogin();
  });
};
