import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/config', () => ({
  mainConfig: { apiUrl: 'https://api.test.invalid' },
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

import { httpRequest, registerSessionAuthPort, sessionAuthHeader } from '@main/infra/http';

const fetchMock = vi.fn();

const ok = (): Response => new Response('{}', { status: 200 });
const unauthorized = (): Response => new Response('no', { status: 401 });

const authHeader = (call: number): string | undefined => {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpRequest session auth', () => {
  it('attaches the live session token as a Bearer header', async () => {
    registerSessionAuthPort({ getToken: () => 'live-token', refresh: vi.fn() });
    fetchMock.mockResolvedValueOnce(ok());

    await httpRequest('/clients', { method: 'GET', auth: 'session' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test.invalid/api/clients');
    expect(authHeader(0)).toBe('Bearer live-token');
  });

  it('refreshes once and retries with the rotated token on a 401', async () => {
    const refresh = vi.fn().mockResolvedValue('rotated-token');
    registerSessionAuthPort({ getToken: () => 'stale-token', refresh });
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());

    const response = await httpRequest('/clients', { method: 'GET', auth: 'session' });

    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(0)).toBe('Bearer stale-token');
    expect(authHeader(1)).toBe('Bearer rotated-token');
  });

  it('triggers exactly one refresh for two concurrent 401s and retries both with the rotated token', async () => {
    // Both requests fly with the same stale token; the rotation is single-use,
    // so only ONE refresh may fire and both retries must reuse its result.
    let resolveRefresh: (token: string) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    registerSessionAuthPort({ getToken: () => 'stale-token', refresh });
    fetchMock
      .mockResolvedValueOnce(unauthorized()) // request A initial
      .mockResolvedValueOnce(unauthorized()) // request B initial
      .mockResolvedValueOnce(ok()) // request A retry
      .mockResolvedValueOnce(ok()); // request B retry

    const a = httpRequest('/clients', { method: 'GET', auth: 'session' });
    const b = httpRequest('/bundle', { method: 'GET', auth: 'session' });
    // Let both initial fetches settle and both land on the shared refresh.
    await Promise.resolve();
    await Promise.resolve();
    resolveRefresh('rotated-token');

    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Both retries carry the single rotated token.
    expect(authHeader(2)).toBe('Bearer rotated-token');
    expect(authHeader(3)).toBe('Bearer rotated-token');
  });

  it('retries with the already-rotated token instead of refreshing again when the token changed mid-flight', async () => {
    // The stored token rotated out from under this request (a concurrent
    // refresh or a login) before its 401 came back, so it must reuse the fresh
    // token rather than burn the now-current single-use token on a refresh.
    const tokens = ['stale-token', 'fresh-token'];
    let read = 0;
    const refresh = vi.fn().mockResolvedValue('should-not-be-used');
    registerSessionAuthPort({
      getToken: () => tokens[Math.min(read++, tokens.length - 1)] ?? null,
      refresh,
    });
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());

    const response = await httpRequest('/clients', { method: 'GET', auth: 'session' });

    expect(response.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    expect(authHeader(0)).toBe('Bearer stale-token');
    expect(authHeader(1)).toBe('Bearer fresh-token');
  });

  it('returns the original rejection when refresh fails', async () => {
    const refresh = vi.fn().mockResolvedValue(null);
    registerSessionAuthPort({ getToken: () => 'stale-token', refresh });
    fetchMock.mockResolvedValueOnce(unauthorized());

    const response = await httpRequest('/clients', { method: 'GET', auth: 'session' });

    expect(response.status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends no Authorization header for auth: none', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await httpRequest('/auth/login', { method: 'POST', auth: 'none', payload: { a: 1 } });
    expect(authHeader(0)).toBeUndefined();
  });
});

describe('sessionAuthHeader', () => {
  it('returns the bearer header when a token is available', () => {
    registerSessionAuthPort({ getToken: () => 'tok', refresh: vi.fn() });
    expect(sessionAuthHeader()).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns an empty object when no token is stored', () => {
    registerSessionAuthPort({ getToken: () => null, refresh: vi.fn() });
    expect(sessionAuthHeader()).toEqual({});
  });
});
