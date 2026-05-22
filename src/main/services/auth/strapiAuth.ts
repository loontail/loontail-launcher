import { HttpError, buildMediaUrl, httpGet, httpPost } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { API_ROUTES } from '@shared/constants';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  StrapiAuthOkSchema,
  type StrapiSession,
  type StrapiUser,
  StrapiUserSchema,
} from '@shared/contracts/auth';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

const logger = scopedLogger('auth.strapi');

const isAuthFailureStatus = (status: number): boolean =>
  status === HTTP_BAD_REQUEST || status === HTTP_UNAUTHORIZED;

// Strapi returns skin/cape as relative `/uploads/...` paths; absolutise via
// the configured API base so the renderer can use them as `<img src>` URLs.
const normalizeStrapiUser = (user: StrapiUser): StrapiUser => ({
  ...user,
  skin: typeof user.skin === 'string' && user.skin.length > 0 ? buildMediaUrl(user.skin) : null,
  cape: typeof user.cape === 'string' && user.cape.length > 0 ? buildMediaUrl(user.cape) : null,
});

const loginErrorFromStatus = (status: number): LoginErrorCode => {
  if (status === HTTP_TOO_MANY_REQUESTS) return LOGIN_ERROR_CODE.RateLimited;
  if (isAuthFailureStatus(status)) return LOGIN_ERROR_CODE.InvalidCredentials;
  return LOGIN_ERROR_CODE.Unknown;
};

export type StrapiLoginOk = { ok: true; session: StrapiSession };
export type StrapiLoginFail = { ok: false; error: LoginErrorCode };
export type StrapiLoginResult = StrapiLoginOk | StrapiLoginFail;

export const loginStrapi = async (payload: LoginPayload): Promise<StrapiLoginResult> => {
  try {
    const parsed = await httpPost(API_ROUTES.auth.login(), StrapiAuthOkSchema, {
      payload,
      auth: 'none',
    });
    const user = normalizeStrapiUser(parsed.user);
    const session: StrapiSession = { provider: 'strapi', jwt: parsed.jwt, user };
    return { ok: true, session };
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

export type VerifyStrapiResult =
  | { kind: 'ok'; session: StrapiSession }
  | { kind: 'expired' } // 401 — caller should clear the session
  | { kind: 'offline' }; // network failure — caller should keep cached

export const verifyStrapi = async (session: StrapiSession): Promise<VerifyStrapiResult> => {
  try {
    const parsed = await httpGet(API_ROUTES.auth.me(), StrapiUserSchema, { auth: 'session' });
    const user = normalizeStrapiUser(parsed);
    return { kind: 'ok', session: { ...session, user } };
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === HTTP_UNAUTHORIZED) return { kind: 'expired' };
      logger.warn(`auth.me failed with status ${error.status}`);
      return { kind: 'offline' };
    }
    logger.warn('auth.me network error — falling back to stored user', error);
    return { kind: 'offline' };
  }
};
