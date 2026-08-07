import { mainConfig } from '@main/config';
import { scopedLogger } from '@main/infra/logger';
import { API_PATH_PREFIX } from '@shared/constants';
import {
  type LoontailAccountResponse,
  LoontailAccountResponseSchema,
  type LoontailAuthResponse,
  LoontailAuthResponseSchema,
} from '@shared/contracts/auth';
import { type ZodTypeAny, z } from 'zod';

const logger = scopedLogger('auth.api');

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

// Every backend failure carries `{ error: { code, message } }`: a stable machine
// code plus a human message the server already computed (e.g. "username 'x' is
// already taken"). Throwing only the status turned a 409 register conflict into a
// generic "something went wrong", so both are decoded and carried on the error.
const ApiErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// Bodies are read fully to parse the envelope, so cap what is accepted: a proxy
// error page or an HTML 502 must never be buffered without bound.
const MAX_ERROR_BODY_CHARS = 4096;
const ERROR_PREVIEW_LIMIT = 200;

type ServerErrorDetail = { code: string | null; message: string | null; preview: string };

const NO_SERVER_ERROR: ServerErrorDetail = { code: null, message: null, preview: '' };

const readServerError = async (response: Response): Promise<ServerErrorDetail> => {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return NO_SERVER_ERROR;
  }
  const preview = text.slice(0, ERROR_PREVIEW_LIMIT);
  if (text.length > MAX_ERROR_BODY_CHARS) return { ...NO_SERVER_ERROR, preview };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON (proxy error page, empty body): the preview is all there is.
    return { ...NO_SERVER_ERROR, preview };
  }
  const parsed = ApiErrorEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ...NO_SERVER_ERROR, preview };
  return { code: parsed.data.error.code, message: parsed.data.error.message, preview };
};

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Machine code from the server envelope, or null when the body was not one.
    readonly code: string | null = null,
    // The server's own user-facing message, or null. Never assume it is safe to
    // render verbatim in a localized UI — map `code` instead.
    readonly serverMessage: string | null = null,
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

const parseJsonResponse = async <TSchema extends ZodTypeAny>(
  response: Response,
  schema: TSchema,
  context: string,
): Promise<z.infer<TSchema>> => {
  if (!response.ok) {
    const detail = await readServerError(response);
    const summary = detail.message ?? detail.preview;
    throw new AuthApiError(
      response.status,
      `${context} failed: HTTP ${response.status}${detail.code ? ` [${detail.code}]` : ''}${
        summary ? ` — ${summary}` : ''
      }`,
      detail.code,
      detail.message,
    );
  }
  const raw: unknown = await response.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(`${context} returned an unexpected shape`, parsed.error);
    throw new AuthApiError(response.status, `${context} returned an invalid response`);
  }
  return parsed.data;
};

const parseAuthResponse = (response: Response, context: string): Promise<LoontailAuthResponse> =>
  parseJsonResponse(response, LoontailAuthResponseSchema, context);

// Deliberately separate from the raw Yggdrasil authserver protocol: the session
// token issued here is the universal API bearer, while the `minecraft` pair feeds
// the in-game handshake.
export type AuthApi = {
  login: (input: { username: string; password: string }) => Promise<LoontailAuthResponse>;
  register: (input: {
    username: string;
    email: string;
    password: string;
  }) => Promise<LoontailAuthResponse>;
  // Rotates the session; the old token is revoked server-side (single-use).
  refresh: (sessionToken: string) => Promise<LoontailAuthResponse>;
  // Non-destructive session probe: leaves the token valid, so a running game
  // keeps the bearer it was handed at launch.
  me: (sessionToken: string) => Promise<LoontailAccountResponse>;
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

  const me: AuthApi['me'] = async (sessionToken) => {
    const response = await fetch(authUrl('/me'), {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    return parseJsonResponse(response, LoontailAccountResponseSchema, 'auth.me');
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

  return { login, register, refresh, me, logout };
};
