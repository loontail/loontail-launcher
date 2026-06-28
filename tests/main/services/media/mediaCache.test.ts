import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  readBuffer: vi.fn(async () => null),
  writeBuffer: vi.fn(async () => undefined),
  deleteBuffer: vi.fn(async () => undefined),
  clearNamespace: vi.fn(async () => undefined),
  getNamespaceSize: vi.fn(async () => 0),
  enforceSizeBound: vi.fn(async () => undefined),
}));

const httpMocks = vi.hoisted(() => ({
  sessionAuthHeader: vi.fn(() => ({ Authorization: 'Bearer live-token' })),
}));

vi.mock('@main/config', () => ({
  mainConfig: { apiUrl: 'https://api.test.invalid' },
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('@main/infra/cache', () => cacheMocks);

vi.mock('@main/infra/http', () => ({
  sessionAuthHeader: httpMocks.sessionAuthHeader,
}));

import { fetchCachedMedia, isTrustedMediaOrigin } from '@main/services/media/mediaCache';

const fetchMock = vi.fn();

const authHeaderOf = (call: number): string | undefined => {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
};

const redirectModeOf = (call: number): RequestRedirect | undefined => {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return init?.redirect;
};

beforeEach(() => {
  fetchMock.mockReset();
  cacheMocks.readBuffer.mockResolvedValue(null);
  httpMocks.sessionAuthHeader.mockReturnValue({ Authorization: 'Bearer live-token' });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('media cache host allowlist', () => {
  it('accepts a URL on the configured API origin and attaches the bearer', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    const result = await fetchCachedMedia('https://api.test.invalid/catalog-media/poster.png');

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(0)).toBe('Bearer live-token');
    expect(redirectModeOf(0)).toBe('manual');
  });

  it('rejects a URL on a non-API host without fetching (SSRF + bearer exfil)', async () => {
    const result = await fetchCachedMedia('http://127.0.0.1:6543/internal');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an off-origin HTTPS host without fetching', async () => {
    const result = await fetchCachedMedia('https://evil.example.com/beacon.png');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect that points off the trusted origin', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.com/steal' },
      }),
    );

    const result = await fetchCachedMedia('https://api.test.invalid/catalog-media/redir.png');

    expect(result).toBeNull();
    // The off-origin hop is rejected before a second fetch is issued, so the
    // bearer never rides to the attacker host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a same-origin redirect with the bearer still attached', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://api.test.invalid/catalog-media/real.png' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('img'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );

    const result = await fetchCachedMedia('https://api.test.invalid/catalog-media/redir.png');

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(1)).toBe('Bearer live-token');
  });
});

describe('isTrustedMediaOrigin', () => {
  it('is true only for the configured API origin', () => {
    expect(isTrustedMediaOrigin('https://api.test.invalid/x.png')).toBe(true);
    expect(isTrustedMediaOrigin('https://api.test.invalid:443/x.png')).toBe(true);
    expect(isTrustedMediaOrigin('https://other.test.invalid/x.png')).toBe(false);
    expect(isTrustedMediaOrigin('http://api.test.invalid/x.png')).toBe(false);
    expect(isTrustedMediaOrigin('not-a-url')).toBe(false);
  });
});
