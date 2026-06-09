import { mainConfig } from '@main/config';
import { scopedLogger } from '@main/infra/logger';
import { API_PATH_PREFIX } from '@shared/constants';
import type { ZodTypeAny, z } from 'zod';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type AuthMode =
  // Static `API_TOKEN` from env; for catalogue/manifest/skin routes that need no per-user identity.
  | 'apiToken'
  // No Authorization header. The Yggdrasil access token is NOT a valid bearer for the Strapi
  // content API, so user-scoped calls go directly through YggdrasilClient, not this helper.
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

export const buildAuthHeader = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

const buildHeaders = (token: string | undefined): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? buildAuthHeader(token) : {}),
});

const resolveBearer = (auth: AuthMode): string | undefined => {
  if (auth === 'none') return undefined;
  return mainConfig.apiToken;
};

const buildUrl = (path: string): string => `${mainConfig.apiUrl}${API_PATH_PREFIX}${path}`;

export const httpRequest = (url: string, options: RequestOptions): Promise<Response> => {
  const { method = 'GET', payload, signal, auth } = options;
  const hasBody = payload !== undefined && method !== 'GET';
  const token = resolveBearer(auth);
  return fetch(buildUrl(url), {
    method,
    headers: buildHeaders(token),
    ...(hasBody ? { body: JSON.stringify(payload) } : {}),
    ...(signal ? { signal } : {}),
  });
};

export const buildMediaUrl = (path: string): string =>
  path.startsWith('http') ? path : `${mainConfig.apiUrl}${path}`;

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

export const httpPost = async <TSchema extends ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: SchemaCallOptions & { payload: unknown },
): Promise<z.infer<TSchema>> => {
  const response = await httpRequest(path, { method: 'POST', ...options });
  if (!response.ok) await throwHttpError(path, 'POST', response);
  const raw: unknown = await response.json();
  return schema.parse(raw);
};

export const httpPutVoid = async (
  path: string,
  payload: unknown,
  options: SchemaCallOptions,
): Promise<void> => {
  const response = await httpRequest(path, { method: 'PUT', payload, ...options });
  if (!response.ok) await throwHttpError(path, 'PUT', response);
};

export const httpPostMultipart = async <TSchema extends ZodTypeAny>(
  path: string,
  schema: TSchema,
  formData: FormData,
  options: SchemaCallOptions,
): Promise<z.infer<TSchema>> => {
  const token = resolveBearer(options.auth);
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    body: formData,
    ...(token ? { headers: buildAuthHeader(token) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) await throwHttpError(path, 'POST', response);
  const raw: unknown = await response.json();
  return schema.parse(raw);
};

// For binary downloads. Takes a raw url (absolute or media path); skips the
// API_PATH_PREFIX since callers typically already hold an absolute media URL.
// No auth header — media URLs in Strapi are publicly reachable and Mojang
// texture URLs (textures.minecraft.net) are public too.
export const httpGetBinary = async (
  absoluteUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<Buffer> => {
  const response = await fetch(absoluteUrl, options.signal ? { signal: options.signal } : {});
  if (!response.ok) {
    const bodyPreview = await readBodyPreview(response);
    logger.warn(`GET ${absoluteUrl} failed: ${response.status} ${response.statusText}`);
    throw new HttpError(response.status, response.statusText, bodyPreview);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
