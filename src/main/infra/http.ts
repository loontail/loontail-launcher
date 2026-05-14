import { mainConfig } from '@main/config';

const API_PATH_PREFIX = '/api';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestOptions = {
  method?: HttpMethod;
  payload?: unknown;
  withToken?: boolean;
  bearer?: string;
};

export const httpRequest = (url: string, options: RequestOptions = {}): Promise<Response> => {
  const { method = 'GET', payload, withToken = true, bearer } = options;
  const hasBody = payload !== undefined && method !== 'GET';
  const token = bearer ?? (withToken ? mainConfig.apiToken : undefined);
  return fetch(`${mainConfig.apiUrl}${API_PATH_PREFIX}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(payload) } : {}),
  });
};

export const buildMediaUrl = (path: string): string =>
  path.startsWith('http') ? path : `${mainConfig.apiUrl}${path}`;
