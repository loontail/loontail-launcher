import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  readBuffer: vi.fn(async (_namespace: string, _key: string): Promise<Buffer | null> => null),
  writeBuffer: vi.fn(
    async (_namespace: string, _key: string, _buffer: Buffer): Promise<boolean> => true,
  ),
  deleteBuffer: vi.fn(async (_namespace: string, _key: string): Promise<void> => undefined),
  clearNamespace: vi.fn(async (_namespace: string): Promise<void> => undefined),
  getNamespaceSize: vi.fn(async (_namespace: string): Promise<number> => 0),
  enforceSizeBound: vi.fn(
    async (_namespace: string, _maxBytes: number, _options?: unknown): Promise<void> => undefined,
  ),
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

const urlOf = (call: number): string | undefined => fetchMock.mock.calls[call]?.[0] as string;

beforeEach(() => {
  fetchMock.mockReset();
  cacheMocks.readBuffer.mockResolvedValue(null);
  cacheMocks.writeBuffer.mockImplementation(async () => true);
  cacheMocks.deleteBuffer.mockImplementation(async () => undefined);
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

  it('fetches a Mojang skin texture over TLS and never sends the bearer to it', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('skin'), { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    // Mojang profile payloads hand out the plaintext URL.
    const result = await fetchCachedMedia('http://textures.minecraft.net/texture/abc123');

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toBe('https://textures.minecraft.net/texture/abc123');
    expect(authHeaderOf(0)).toBeUndefined();
  });

  it('does not follow a redirect off the Mojang texture host', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }),
    );

    const result = await fetchCachedMedia('https://textures.minecraft.net/texture/abc123');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect that drops TLS even when the hop stays on a trusted host', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://textures.minecraft.net/texture/plain' },
      }),
    );

    const result = await fetchCachedMedia('https://textures.minecraft.net/texture/abc123');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a look-alike of the Mojang texture host', async () => {
    const result = await fetchCachedMedia('https://textures.minecraft.net.evil.example.com/x.png');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('media cache mime sidecar', () => {
  const URL_WITHOUT_EXTENSION = 'https://api.test.invalid/catalog-media/poster';

  it('writes the body before the sidecar so validators never describe missing bytes', async () => {
    // The sidecar carries the validators and storedAt that suppress the next
    // revalidation, so a sidecar committed over bytes that failed to land pins the
    // stale copy for a full day.
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/webp' } }),
    );

    await fetchCachedMedia(URL_WITHOUT_EXTENSION);

    const keys = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.endsWith('.type')).toBe(false);
    expect(keys[1]).toBe(`${keys[0]}.type`);
  });

  it('does not commit the sidecar when the body write fails', async () => {
    cacheMocks.writeBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type'),
    );
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/webp' } }),
    );

    await fetchCachedMedia(URL_WITHOUT_EXTENSION);

    const keys = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(keys.some((key) => key.endsWith('.type'))).toBe(false);
  });

  it('drops the sidecar when its own write fails so the pair is never mismatched', async () => {
    cacheMocks.writeBuffer.mockImplementation(
      async (_ns: string, key: string) => !key.endsWith('.type'),
    );
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/webp' } }),
    );

    await fetchCachedMedia(URL_WITHOUT_EXTENSION);

    const deleted = cacheMocks.deleteBuffer.mock.calls.map((call) => call[1] as string);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.endsWith('.type')).toBe(true);
  });

  it('ignores a sidecar whose MIME type is a torn write', async () => {
    // A killed storeMeta leaves `{"mimeType":"image/pn` on disk, which JSON.parse
    // rejects; handing the raw text to the protocol layer put it in a Content-Type.
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type')
        ? Buffer.from('{"mimeType":"image/pn', 'utf8')
        : Buffer.from('cached-bytes'),
    );

    const result = await fetchCachedMedia('https://api.test.invalid/catalog-media/poster.png');

    expect(result?.mimeType).toBe('image/png');
  });

  it('reports the stored content type on a cache hit', async () => {
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type')
        ? Buffer.from(JSON.stringify({ mimeType: 'image/webp', storedAt: Date.now() }), 'utf8')
        : Buffer.from('cached-bytes'),
    );

    const result = await fetchCachedMedia(URL_WITHOUT_EXTENSION);

    expect(result?.mimeType).toBe('image/webp');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still resolves a mime when the sidecar was evicted from under the body', async () => {
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type') ? null : Buffer.from('cached-bytes'),
    );

    const result = await fetchCachedMedia('https://api.test.invalid/catalog-media/poster.png');

    expect(result).toMatchObject({ mimeType: 'image/png' });
  });

  it('reads a pre-metadata sidecar that held the raw content type', async () => {
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type') ? Buffer.from('image/avif', 'utf8') : Buffer.from('cached-bytes'),
    );

    const result = await fetchCachedMedia(URL_WITHOUT_EXTENSION);

    expect(result?.mimeType).toBe('image/avif');
  });
});

describe('media cache freshness', () => {
  const POSTER = 'https://api.test.invalid/catalog-media/poster';

  const cachedWithMeta = (storedAt: number, etag: string | null): void => {
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type')
        ? Buffer.from(JSON.stringify({ mimeType: 'image/png', etag, storedAt }), 'utf8')
        : Buffer.from('stale-bytes'),
    );
  };

  const settleBackgroundWork = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('serves a fresh entry without touching the network', async () => {
    cachedWithMeta(Date.now(), '"v1"');

    await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replaces a stale entry in the background with the newer body', async () => {
    // Without revalidation a poster replaced in place at the same URL stayed
    // frozen until the user pressed Clear cache.
    cachedWithMeta(Date.now() - 2 * 24 * 60 * 60 * 1000, '"v1"');
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('fresh-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png', etag: '"v2"' },
      }),
    );

    const served = await fetchCachedMedia(POSTER);
    expect(served?.body.toString()).toBe('stale-bytes');

    await settleBackgroundWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((headers?.headers as Record<string, string> | undefined)?.['If-None-Match']).toBe(
      '"v1"',
    );
    const bodies = cacheMocks.writeBuffer.mock.calls.map((call) => call[2] as Buffer);
    expect(bodies.some((body) => body.toString() === 'fresh-bytes')).toBe(true);
  });

  it('keeps the cached body on a 304 and stops re-asking for a day', async () => {
    cachedWithMeta(Date.now() - 2 * 24 * 60 * 60 * 1000, '"v1"');
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));

    await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only the sidecar is rewritten (a refreshed timestamp); the body is intact.
    const keys = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(keys.every((key) => key.endsWith('.type'))).toBe(true);
  });

  it('replaces the body before the new validators on a revalidation', async () => {
    cachedWithMeta(Date.now() - 2 * 24 * 60 * 60 * 1000, '"v1"');
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('fresh-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', etag: '"v2"' },
      }),
    );

    await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    const keys = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.endsWith('.type')).toBe(false);
    expect(keys[1]).toBe(`${keys[0]}.type`);
  });

  it('keeps the old validators when a revalidated body fails to land', async () => {
    // Committing `etag: v2` / `mimeType: image/jpeg` over bytes that never landed
    // pinned the old body under fresh validators: storedAt kept being refreshed by
    // the following 304s, so the entry never recovered.
    cachedWithMeta(Date.now() - 2 * 24 * 60 * 60 * 1000, '"v1"');
    cacheMocks.writeBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type'),
    );
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('fresh-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', etag: '"v2"' },
      }),
    );

    await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    const keys = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(keys.some((key) => key.endsWith('.type'))).toBe(false);
  });

  it('repairs a body whose sidecar is missing instead of guessing forever', async () => {
    // readMeta returning null used to skip scheduleRevalidation entirely, so an
    // extensionless entry served application/octet-stream until it was evicted.
    cacheMocks.readBuffer.mockImplementation(async (_ns: string, key: string) =>
      key.endsWith('.type') ? null : Buffer.from('cached-bytes'),
    );
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('fresh-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      }),
    );

    const served = await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    expect(served?.mimeType).toBe('application/octet-stream');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const written = cacheMocks.writeBuffer.mock.calls.map((call) => call[1] as string);
    expect(written.some((key) => key.endsWith('.type'))).toBe(true);
  });

  it('keeps serving the cached body when revalidation fails', async () => {
    cachedWithMeta(Date.now() - 2 * 24 * 60 * 60 * 1000, null);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const served = await fetchCachedMedia(POSTER);
    await settleBackgroundWork();

    expect(served?.body.toString()).toBe('stale-bytes');
    expect(cacheMocks.writeBuffer).not.toHaveBeenCalled();
  });
});

describe('isTrustedMediaOrigin', () => {
  it('is true only for the configured API origin', () => {
    expect(isTrustedMediaOrigin('https://api.test.invalid/x.png')).toBe(true);
    expect(isTrustedMediaOrigin('https://api.test.invalid:443/x.png')).toBe(true);
    expect(isTrustedMediaOrigin('https://other.test.invalid/x.png')).toBe(false);
    expect(isTrustedMediaOrigin('http://api.test.invalid/x.png')).toBe(false);
    expect(isTrustedMediaOrigin('not-a-url')).toBe(false);
    // Mojang textures are reachable over either scheme (the fetch is upgraded to
    // TLS) but a look-alike suffix is not.
    expect(isTrustedMediaOrigin('http://textures.minecraft.net/texture/a')).toBe(true);
    expect(isTrustedMediaOrigin('https://textures.minecraft.net/texture/a')).toBe(true);
    expect(isTrustedMediaOrigin('https://textures.minecraft.net.evil.example.com/a')).toBe(false);
  });
});
