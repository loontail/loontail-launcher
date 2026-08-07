import { mainConfig } from '@main/config';
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from '@main/constants/http';
import { scopedLogger } from '@main/infra/logger';
import { API_PATH_PREFIX } from '@shared/constants';
import type { ZodTypeAny, z } from 'zod';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type AuthMode =
  // Attach the session token as `Authorization: Bearer`; a 401/403 triggers a
  // single refresh-and-retry before the call fails.
  | 'session'
  // No Authorization header, for the auth endpoints themselves.
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

// The auth service registers these at init so http.ts can attach the live bearer
// and rotate the session without importing auth/store (avoids an import cycle).
export type SessionAuthPort = {
  getToken: () => string | null;
  // Refresh the stored session and return the rotated token, or null on failure
  // (the user must re-authenticate). MUST be single-flight: rotation is
  // single-use server-side, so N parallel 401s have to share one round-trip and
  // retry with the same rotated token. The implementation memoizes the in-flight
  // rotation (createSessionRefresher).
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
  const requestToken = port.getToken();
  const response = await rawFetch(fullUrl, method, payload, requestToken ?? undefined, signal);
  if (!isSessionRejection(response)) return response;
  // A concurrent request may have already rotated the token while this call was
  // in flight; retry with it rather than burning the now-current single-use token.
  const current = port.getToken();
  if (current && current !== requestToken) {
    return rawFetch(fullUrl, method, payload, current, signal);
  }
  // Otherwise rotate and retry; a failed refresh leaves the original rejection
  // to surface a re-login. `port.refresh` is single-flight (see
  // createSessionRefresher), so N parallel 401s share one rotation.
  logger.warn(`${method} ${url} rejected (${response.status}); attempting session refresh`);
  const rotated = await port.refresh();
  if (!rotated) return response;
  return rawFetch(fullUrl, method, payload, rotated, signal);
};

export const buildMediaUrl = (path: string): string =>
  path.startsWith('http') ? path : `${mainConfig.apiUrl}${path}`;

// Authorization header for the raw-fetch paths (bundle file download, media
// cache) that bypass `httpRequest`. Bundle `/files` and texture media require a
// session, so the live bearer must ride along. Returns an empty object when no
// session is stored — the server then decides (public assets resolve; gated 401).
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
