import { scopedLogger } from '@main/infra/logger';
import type { StoredApiSession } from '@main/infra/store';
import type { Account } from '@shared/contracts/account';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type LoontailAuthResponse,
  type RegisterPayload,
  type YggdrasilSession,
} from '@shared/contracts/auth';
import { undashUuid } from '@shared/yggdrasil/uuid';
import {
  type AuthApi,
  AuthApiError,
  isAuthCredentialRejection,
  isAuthRateLimited,
} from './authApi';

const logger = scopedLogger('auth.loontail');

// The three pieces the launcher tracks separately: the in-game Yggdrasil session,
// the universal API bearer with its expiry (`apiSession`), and the
// renderer-facing account.
export type AuthenticatedIdentity = {
  session: YggdrasilSession;
  apiSession: StoredApiSession;
  account: Account;
};

export type LoontailAuthOk = { ok: true; identity: AuthenticatedIdentity };
export type LoontailAuthFail = { ok: false; error: LoginErrorCode };
export type LoontailAuthResult = LoontailAuthOk | LoontailAuthFail;

// Epoch-ms cutoff that separates a seconds-based timestamp from a millisecond
// one (year 2001 in ms, year 33658 in s). The server sends RFC 3339, but the
// contract also admits a numeric timestamp and the two units are otherwise
// indistinguishable.
const EPOCH_MS_THRESHOLD = 1_000_000_000_000;

const numericExpiresAtToMs = (value: number): number =>
  value >= EPOCH_MS_THRESHOLD ? value : value * 1000;

const parseExpiresAt = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? numericExpiresAtToMs(value) : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : null;
};

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
  return {
    session,
    apiSession: {
      token: response.session.token,
      expiresAt: parseExpiresAt(response.session.expiresAt),
    },
    account,
  };
};

// A bare TypeError from undici means the request never reached the server.
const errorToLoginCode = (error: unknown): LoginErrorCode => {
  if (isAuthRateLimited(error)) return LOGIN_ERROR_CODE.RATE_LIMITED;
  if (isAuthCredentialRejection(error)) return LOGIN_ERROR_CODE.INVALID_CREDENTIALS;
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NETWORK_ERROR;
  if (error instanceof AuthApiError && error.status === 0) return LOGIN_ERROR_CODE.NETWORK_ERROR;
  return LOGIN_ERROR_CODE.UNKNOWN;
};

// `expired` = server rejected the token (clear the session); `offline` = server
// unreachable (keep the cached session and retry later).
export type RefreshResult =
  | { kind: 'ok'; identity: AuthenticatedIdentity }
  | { kind: 'expired' }
  | { kind: 'offline' };

// Outcome of the non-destructive session probe. Unlike `refresh`, only an
// explicit credential rejection is fatal: a 5xx or a malformed body keeps the
// cached session (`offline`) rather than signing the user out over a hiccup.
export type ValidateResult =
  | { kind: 'ok'; account: Account }
  | { kind: 'expired' }
  | { kind: 'offline' };

export type ValidateSession = (sessionToken: string) => Promise<ValidateResult>;

export type LoontailAuth = {
  signIn: (payload: LoginPayload) => Promise<LoontailAuthResult>;
  register: (payload: RegisterPayload) => Promise<LoontailAuthResult>;
  refresh: (sessionToken: string) => Promise<RefreshResult>;
  validate: ValidateSession;
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
      if (code === LOGIN_ERROR_CODE.UNKNOWN) {
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
        logger.warn('Session refresh hit a network error; keeping the stored session', error);
        return { kind: 'offline' };
      }
      logger.warn('Session refresh failed; the user must re-authenticate', error);
      return { kind: 'expired' };
    }
  };

  const validate: ValidateSession = async (sessionToken) => {
    try {
      const account = await api.me(sessionToken);
      return {
        kind: 'ok',
        account: {
          provider: 'yggdrasil',
          username: account.username,
          email: account.email ?? null,
          skin: null,
          cape: null,
        },
      };
    } catch (error) {
      if (isAuthCredentialRejection(error)) return { kind: 'expired' };
      logger.warn('Session validation was inconclusive; keeping the stored session', error);
      return { kind: 'offline' };
    }
  };

  const signOut = (sessionToken: string): Promise<void> =>
    api.logout(sessionToken).catch((error: unknown) => {
      logger.warn('Loontail sign-out cleanup failed after local logout', error);
    });

  return { signIn, register, refresh, validate, signOut };
};
