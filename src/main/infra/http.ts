import { mainConfig } from '@main/config';
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from '@main/constants/http';
import { scopedLogger } from '@main/infra/logger';
import { API_PATH_PREFIX } from '@shared/constants';
import type { ZodTypeAny, z } from 'zod';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type AuthMode =
  // The live Loontail session token is attached as `Authorization: Bearer`.
  // This is the universal API bearer: catalogue, bundle manifest, and texture
  // routes all now require a session. A 401/403 triggers a single
  // refresh-and-retry before the call is allowed to fail.
  | 'session'
  // No Authorization header. For the auth endpoints themselves, which either
  // take credentials in the body (login/register) or carry their own bearer.
  | 'none';

type RequestOptions = {
  method?: HttpMethod;
  payload?: unknown;
  auth: AuthMode;
  signal?: AbortSignal;
};

const logger = scopedLogger('infra.http');

const BODY_PREVIEW_LIMIT = 500;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly bodyPreview?: string,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HttpError';
  }
}

// The auth service owns the session token and the refresh flow, so it registers
// these accessors at init. http.ts stays decoupled from the auth/store modules
// (avoiding an import cycle) while still being able to attach the live bearer
// and recover from a 401/403 by rotating the session once.
export type SessionAuthPort = {
  // Current session token, or null when no session is stored.
  getToken: () => string | null;
  // Refresh the stored session (POST /api/auth/refresh) and return the rotated
  // token, or null if refresh failed (the user must re-authenticate).
  refresh: () => Promise<string | null>;
};

let sessionPort: SessionAuthPort | null = null;

export const registerSessionAuthPort = (port: SessionAuthPort): void => {
  sessionPort = port;
};

const requireSessionPort = (): SessionAuthPort => {
  if (!sessionPort) {
    throw new Error('Session auth port is not registered');
  }
  return sessionPort;
};

const buildHeaders = (token: string | undefined): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const buildUrl = (path: string): string => `${mainConfig.apiUrl}${API_PATH_PREFIX}${path}`;

const rawFetch = (
  url: string,
  method: HttpMethod,
  payload: unknown,
  token: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Response> => {
  const hasBody = payload !== undefined && method !== 'GET';
  return fetch(url, {
    method,
    headers: buildHeaders(token),
    ...(hasBody ? { body: JSON.stringify(payload) } : {}),
    ...(signal ? { signal } : {}),
  });
};

const isSessionRejection = (response: Response): boolean =>
  response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN;

export const httpRequest = async (url: string, options: RequestOptions): Promise<Response> => {
  const { method = 'GET', payload, signal, auth } = options;
  const fullUrl = buildUrl(url);
  if (auth === 'none') {
    return rawFetch(fullUrl, method, payload, undefined, signal);
  }
  const port = requireSessionPort();
  const response = await rawFetch(fullUrl, method, payload, port.getToken() ?? undefined, signal);
  if (!isSessionRejection(response)) return response;
  // 401/403: the session may have expired. Rotate it once and retry; if refresh
  // fails the original rejection stands and the caller surfaces a re-login.
  logger.warn(`${method} ${url} rejected (${response.status}); attempting session refresh`);
  const rotated = await port.refresh();
  if (!rotated) return response;
  return rawFetch(fullUrl, method, payload, rotated, signal);
};

export const buildMediaUrl = (path: string): string =>
  path.startsWith('http') ? path : `${mainConfig.apiUrl}${path}`;

// Authorization header for the raw-fetch paths (bundle file download, media
// cache) that bypass `httpRequest`. Bundle `/files` and CMS/textures media
// now require a session, so the live bearer must ride along. Returns an empty
// object when no session is stored — the request proceeds unauthenticated and
// the server decides (public assets still resolve; gated ones 401).
export const sessionAuthHeader = (): Record<string, string> => {
  const token = sessionPort?.getToken() ?? null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const readBodyPreview = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await response.text();
    return text.slice(0, BODY_PREVIEW_LIMIT);
  } catch {
    return undefined;
  }
};

const throwHttpError = async (
  path: string,
  method: HttpMethod,
  response: Response,
): Promise<never> => {
  const bodyPreview = await readBodyPreview(response);
  logger.warn(`${method} ${path} failed: ${response.status} ${response.statusText}`);
  throw new HttpError(response.status, response.statusText, bodyPreview);
};

type SchemaCallOptions = {
  signal?: AbortSignal;
  auth: AuthMode;
};

export const httpGet = async <TSchema extends ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: SchemaCallOptions,
): Promise<z.infer<TSchema>> => {
  const response = await httpRequest(path, { method: 'GET', ...options });
  if (!response.ok) await throwHttpError(path, 'GET', response);
  const raw: unknown = await response.json();
  return schema.parse(raw);
};
