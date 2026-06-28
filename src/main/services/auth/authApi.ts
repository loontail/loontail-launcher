import { mainConfig } from '@main/config';
import { scopedLogger } from '@main/infra/logger';
import { API_PATH_PREFIX } from '@shared/constants';
import { type LoontailAuthResponse, LoontailAuthResponseSchema } from '@shared/contracts/auth';

const logger = scopedLogger('auth.api');

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

export const isAuthCredentialRejection = (error: unknown): boolean =>
  error instanceof AuthApiError &&
  (error.status === HTTP_UNAUTHORIZED || error.status === HTTP_FORBIDDEN);

export const isAuthRateLimited = (error: unknown): boolean =>
  error instanceof AuthApiError && error.status === HTTP_TOO_MANY_REQUESTS;

const authUrl = (path: string): string => `${mainConfig.apiUrl}${API_PATH_PREFIX}/auth${path}`;

const parseAuthResponse = async (
  response: Response,
  context: string,
): Promise<LoontailAuthResponse> => {
  if (!response.ok) {
    let preview = '';
    try {
      preview = (await response.text()).slice(0, 200);
    } catch {
      /* status alone is enough to throw */
    }
    throw new AuthApiError(
      response.status,
      `${context} failed: HTTP ${response.status}${preview ? ` — ${preview}` : ''}`,
    );
  }
  const raw: unknown = await response.json();
  const parsed = LoontailAuthResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(`${context} returned an unexpected shape`, parsed.error);
    throw new AuthApiError(response.status, `${context} returned an invalid response`);
  }
  return parsed.data;
};

// Deliberately separate from `@loontail/yggdrasil-client` (which speaks the
// Yggdrasil authserver protocol): the session token issued here is the universal
// API bearer, while the `minecraft` pair feeds the in-game handshake.
export type AuthApi = {
  login: (input: { username: string; password: string }) => Promise<LoontailAuthResponse>;
  register: (input: {
    username: string;
    email: string;
    password: string;
  }) => Promise<LoontailAuthResponse>;
  // Rotates the session; the old token is revoked server-side (single-use).
  refresh: (sessionToken: string) => Promise<LoontailAuthResponse>;
  logout: (sessionToken: string) => Promise<void>;
};

export const createAuthApi = (): AuthApi => {
  const login: AuthApi['login'] = async (input) => {
    const response = await fetch(authUrl('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseAuthResponse(response, 'auth.login');
  };

  const register: AuthApi['register'] = async (input) => {
    const response = await fetch(authUrl('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseAuthResponse(response, 'auth.register');
  };

  const refresh: AuthApi['refresh'] = async (sessionToken) => {
    const response = await fetch(authUrl('/refresh'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    return parseAuthResponse(response, 'auth.refresh');
  };

  const logout: AuthApi['logout'] = async (sessionToken) => {
    const response = await fetch(authUrl('/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      logger.warn(`auth.logout returned HTTP ${response.status}; token will expire server-side`);
    }
  };

  return { login, register, refresh, logout };
};
