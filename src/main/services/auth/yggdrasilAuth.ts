import {
  type YggdrasilClient,
  YggdrasilClientError,
  YggdrasilClientErrorCodes,
} from '@loontail/yggdrasil-client';
import { undashUuid } from '@loontail/yggdrasil-core';
import { HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS } from '@main/constants/http';
import { scopedLogger } from '@main/infra/logger';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type YggdrasilSession,
} from '@shared/contracts/auth';

const logger = scopedLogger('auth.yggdrasil');

const isHttpStatus = (error: unknown, status: number): boolean =>
  error instanceof YggdrasilClientError &&
  error.code === YggdrasilClientErrorCodes.HTTP_ERROR &&
  error.context?.status === status;

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof YggdrasilClientError && error.code === YggdrasilClientErrorCodes.NETWORK;

const loginErrorFromError = (error: unknown): LoginErrorCode => {
  if (isHttpStatus(error, HTTP_TOO_MANY_REQUESTS)) return LOGIN_ERROR_CODE.RateLimited;
  if (isHttpStatus(error, HTTP_FORBIDDEN)) return LOGIN_ERROR_CODE.InvalidCredentials;
  if (isNetworkFailure(error)) return LOGIN_ERROR_CODE.NetworkError;
  return LOGIN_ERROR_CODE.Unknown;
};

export type YggdrasilLoginOk = { ok: true; session: YggdrasilSession };
export type YggdrasilLoginFail = { ok: false; error: LoginErrorCode };
export type YggdrasilLoginResult = YggdrasilLoginOk | YggdrasilLoginFail;

export type VerifyYggdrasilResult =
  | { kind: 'ok'; session: YggdrasilSession }
  | { kind: 'expired' }
  | { kind: 'offline' }
  // The server was reachable but failed unexpectedly (5xx, malformed response,
  // TLS error). Distinct from `offline` so a server fault is not misreported as
  // a network partition.
  | { kind: 'server-error' };

export type YggdrasilAuth = {
  signIn: (payload: LoginPayload) => Promise<YggdrasilLoginResult>;
  verifySession: (session: YggdrasilSession) => Promise<VerifyYggdrasilResult>;
  signOut: (session: YggdrasilSession) => Promise<void>;
};

type IssuedSession = {
  accessToken: string;
  clientToken: string;
  selectedProfile: { id: string; name: string };
};

// Build a stored session from an authenticate/refresh result. Normalises the
// server-provided UUID to lowercase undashed so all downstream code (storage,
// IPC, launch composer) sees the same shape regardless of upstream casing.
const sessionFromIssued = (issued: IssuedSession): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: issued.accessToken,
  clientToken: issued.clientToken,
  profile: { uuid: undashUuid(issued.selectedProfile.id), name: issued.selectedProfile.name },
});

export const createYggdrasilAuth = (client: YggdrasilClient): YggdrasilAuth => {
  const signIn = async (payload: LoginPayload): Promise<YggdrasilLoginResult> => {
    try {
      const issued = await client.authenticate({
        username: payload.identifier,
        password: payload.password,
      });
      return { ok: true, session: sessionFromIssued(issued) };
    } catch (error) {
      const code = loginErrorFromError(error);
      if (code === LOGIN_ERROR_CODE.Unknown) {
        logger.warn('Yggdrasil sign-in failed with an unexpected error', error);
      }
      return { ok: false, error: code };
    }
  };

  // First try `validate` (cheap, 204/403). If the server rejects the token,
  // attempt a `refresh` — the access token may simply be near expiry while
  // the client token is still good. Refresh succeeds → rotated session;
  // refresh fails → genuinely expired.
  const verifySession = async (session: YggdrasilSession): Promise<VerifyYggdrasilResult> => {
    try {
      const ok = await client.validate({
        accessToken: session.accessToken,
        clientToken: session.clientToken,
      });
      if (ok) return { kind: 'ok', session };
    } catch (error) {
      if (isNetworkFailure(error)) return { kind: 'offline' };
      logger.warn('Yggdrasil validate failed with a server error', error);
      return { kind: 'server-error' };
    }

    try {
      const rotated = await client.refresh({
        accessToken: session.accessToken,
        clientToken: session.clientToken,
      });
      return { kind: 'ok', session: sessionFromIssued(rotated) };
    } catch (error) {
      if (isHttpStatus(error, HTTP_FORBIDDEN)) return { kind: 'expired' };
      if (isNetworkFailure(error)) return { kind: 'offline' };
      logger.warn('Yggdrasil refresh failed unexpectedly', error);
      return { kind: 'expired' };
    }
  };

  const signOut = async (session: YggdrasilSession): Promise<void> => {
    try {
      await client.invalidate({
        accessToken: session.accessToken,
        clientToken: session.clientToken,
      });
    } catch (error) {
      logger.warn('Yggdrasil invalidate failed — server-side token will expire naturally', error);
    }
  };

  return { signIn, verifySession, signOut };
};
