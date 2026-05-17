import { HttpError, buildMediaUrl, httpGet, httpPost } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { API_ROUTES } from '@shared/constants';
import {
  type Account,
  AccountSchema,
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type LoginResult,
  StrapiAuthOkSchema,
} from '@shared/contracts';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

const logger = scopedLogger('auth');

const isAuthFailureStatus = (status: number): boolean =>
  status === HTTP_BAD_REQUEST || status === HTTP_UNAUTHORIZED;

const normalizeAccount = (account: Account): Account => ({
  ...account,
  skin:
    typeof account.skin === 'string' && account.skin.length > 0
      ? buildMediaUrl(account.skin)
      : null,
  cape:
    typeof account.cape === 'string' && account.cape.length > 0
      ? buildMediaUrl(account.cape)
      : null,
});

const loginErrorFromStatus = (status: number): LoginErrorCode => {
  if (status === HTTP_TOO_MANY_REQUESTS) return LOGIN_ERROR_CODE.RateLimited;
  if (isAuthFailureStatus(status)) return LOGIN_ERROR_CODE.InvalidCredentials;
  return LOGIN_ERROR_CODE.Unknown;
};

export const login = async (payload: LoginPayload): Promise<LoginResult> => {
  try {
    const parsed = await httpPost(API_ROUTES.auth.login(), StrapiAuthOkSchema, {
      payload,
      withToken: false,
    });
    const user = normalizeAccount(parsed.user);
    setStoredAuth({ jwt: parsed.jwt, user });
    return { ok: true, user };
  } catch (error) {
    if (error instanceof HttpError) {
      const code = loginErrorFromStatus(error.status);
      if (code === LOGIN_ERROR_CODE.Unknown) {
        logger.warn(`Login failed with status ${error.status}`);
      }
      return { ok: false, error: code };
    }
    logger.error('Login network error', error);
    return { ok: false, error: LOGIN_ERROR_CODE.NetworkError };
  }
};

export const fetchCurrentUser = async (): Promise<Account | null> => {
  const stored = getStoredAuth();
  if (stored === null) return null;

  try {
    const parsed = await httpGet(API_ROUTES.auth.me(), AccountSchema, { bearer: stored.jwt });
    const user = normalizeAccount(parsed);
    setStoredAuth({ jwt: stored.jwt, user });
    return user;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === HTTP_UNAUTHORIZED) {
        clearStoredAuth();
        return null;
      }
      logger.warn(`auth.me failed with status ${error.status}`);
      return stored.user;
    }
    logger.warn('auth.me network error — falling back to stored user', error);
    return stored.user;
  }
};

export const logout = (): void => {
  clearStoredAuth();
};

export const getStoredAccount = (): Account | null => {
  const stored = getStoredAuth();
  return stored?.user ?? null;
};
