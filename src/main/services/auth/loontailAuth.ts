import { undashUuid } from '@loontail/yggdrasil-core';
import { scopedLogger } from '@main/infra/logger';
import type { Account } from '@shared/contracts/account';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type LoontailAuthResponse,
  type RegisterPayload,
  type YggdrasilSession,
} from '@shared/contracts/auth';
import {
  type AuthApi,
  AuthApiError,
  isAuthCredentialRejection,
  isAuthRateLimited,
} from './authApi';

const logger = scopedLogger('auth.loontail');

// A successful authentication splits into the three pieces the launcher tracks
// separately: the in-game Yggdrasil session (fed to the game), the universal
// API bearer (`sessionToken`), and the renderer-facing account (with email).
export type AuthenticatedIdentity = {
  session: YggdrasilSession;
  sessionToken: string;
  account: Account;
};

export type LoontailAuthOk = { ok: true; identity: AuthenticatedIdentity };
export type LoontailAuthFail = { ok: false; error: LoginErrorCode };
export type LoontailAuthResult = LoontailAuthOk | LoontailAuthFail;

const identityFromResponse = (response: LoontailAuthResponse): AuthenticatedIdentity => {
  const uuid = undashUuid(response.profile.uuid);
  const session: YggdrasilSession = {
    provider: 'yggdrasil',
    accessToken: response.minecraft.accessToken,
    clientToken: response.minecraft.clientToken,
    profile: { uuid, name: response.profile.username },
  };
  const account: Account = {
    provider: 'yggdrasil',
    username: response.profile.username,
    email: response.profile.email ?? null,
    skin: null,
    cape: null,
  };
  return { session, sessionToken: response.session.token, account };
};

// Map a transport/HTTP failure to the renderer's `LoginErrorCode`. A bare
// TypeError from undici means the request never reached the server.
const errorToLoginCode = (error: unknown): LoginErrorCode => {
  if (isAuthRateLimited(error)) return LOGIN_ERROR_CODE.RateLimited;
  if (isAuthCredentialRejection(error)) return LOGIN_ERROR_CODE.InvalidCredentials;
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NetworkError;
  if (error instanceof AuthApiError && error.status === 0) return LOGIN_ERROR_CODE.NetworkError;
  return LOGIN_ERROR_CODE.Unknown;
};

// Result of a session refresh. `expired` means the server rejected the token
// (the session is gone — clear it); `offline` means the server was unreachable
// (keep the cached session and retry later).
export type RefreshResult =
  | { kind: 'ok'; identity: AuthenticatedIdentity }
  | { kind: 'expired' }
  | { kind: 'offline' };

export type LoontailAuth = {
  signIn: (payload: LoginPayload) => Promise<LoontailAuthResult>;
  register: (payload: RegisterPayload) => Promise<LoontailAuthResult>;
  // Rotate the session given the current API bearer.
  refresh: (sessionToken: string) => Promise<RefreshResult>;
  signOut: (sessionToken: string) => Promise<void>;
};

export const createLoontailAuth = (api: AuthApi): LoontailAuth => {
  const runAuth = async (
    label: string,
    call: () => Promise<LoontailAuthResponse>,
  ): Promise<LoontailAuthResult> => {
    try {
      return { ok: true, identity: identityFromResponse(await call()) };
    } catch (error) {
      const code = errorToLoginCode(error);
      if (code === LOGIN_ERROR_CODE.Unknown) {
        logger.warn(`${label} failed with an unexpected error`, error);
      }
      return { ok: false, error: code };
    }
  };

  const signIn = (payload: LoginPayload): Promise<LoontailAuthResult> =>
    runAuth('Loontail sign-in', () =>
      api.login({ username: payload.identifier, password: payload.password }),
    );

  const register = (payload: RegisterPayload): Promise<LoontailAuthResult> =>
    runAuth('Loontail register', () =>
      api.register({
        username: payload.username,
        email: payload.email,
        password: payload.password,
      }),
    );

  const refresh = async (sessionToken: string): Promise<RefreshResult> => {
    try {
      return { kind: 'ok', identity: identityFromResponse(await api.refresh(sessionToken)) };
    } catch (error) {
      if (error instanceof TypeError) {
        // Network blip — keep the session and let the next call retry.
        logger.warn('Session refresh hit a network error; keeping the stored session', error);
        return { kind: 'offline' };
      }
      logger.warn('Session refresh failed; the user must re-authenticate', error);
      return { kind: 'expired' };
    }
  };

  const signOut = (sessionToken: string): Promise<void> =>
    api.logout(sessionToken).catch((error: unknown) => {
      logger.warn('Loontail sign-out cleanup failed after local logout', error);
    });

  return { signIn, register, refresh, signOut };
};
