import { buildMediaUrl, httpRequest } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { API_ROUTES } from '@shared/constants';
import {
  type Account,
  AccountSchema,
  LOGIN_ERROR_CODE,
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

export const login = async (payload: LoginPayload): Promise<LoginResult> => {
  try {
    const response = await httpRequest(API_ROUTES.auth.login(), {
      method: 'POST',
      payload,
      withToken: false,
    });

    if (!response.ok) {
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        return { ok: false, error: LOGIN_ERROR_CODE.RateLimited };
      }
      if (isAuthFailureStatus(response.status)) {
        return { ok: false, error: LOGIN_ERROR_CODE.InvalidCredentials };
      }
      logger.warn(`Login failed with status ${response.status}`);
      return { ok: false, error: LOGIN_ERROR_CODE.Unknown };
    }

    const raw: unknown = await response.json();
    const parsed = StrapiAuthOkSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('Login response did not match schema', parsed.error.format());
      return { ok: false, error: LOGIN_ERROR_CODE.Unknown };
    }

    const user = normalizeAccount(parsed.data.user);
    setStoredAuth({ jwt: parsed.data.jwt, user });
    return { ok: true, user };
  } catch (error) {
    logger.error('Login network error', error);
    return { ok: false, error: LOGIN_ERROR_CODE.NetworkError };
  }
};

export const fetchCurrentUser = async (): Promise<Account | null> => {
  const stored = getStoredAuth();
  if (stored === null) return null;

  try {
    const response = await httpRequest(API_ROUTES.auth.me(), {
      method: 'GET',
      withToken: false,
      bearer: stored.jwt,
    });

    if (response.status === HTTP_UNAUTHORIZED) {
      clearStoredAuth();
      return null;
    }

    if (!response.ok) {
      logger.warn(`auth.me failed with status ${response.status}`);
      return stored.user;
    }

    const raw: unknown = await response.json();
    const parsed = AccountSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('auth.me response did not match schema', parsed.error.format());
      return stored.user;
    }

    const user = normalizeAccount(parsed.data);
    setStoredAuth({ jwt: stored.jwt, user });
    return user;
  } catch (error) {
    logger.error('auth.me network error', error);
    return stored.user;
  }
};

export const logout = (): void => {
  clearStoredAuth();
};
