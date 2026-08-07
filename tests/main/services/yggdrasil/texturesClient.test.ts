import { YggdrasilTexturesClient } from '@main/services/yggdrasil/texturesClient';
import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
import { describe, expect, it, vi } from 'vitest';

const API_ROOT = 'https://api.test.invalid';
const DASHED = 'aabbccdd-eeff-0011-2233-445566778899';
const UNDASHED = 'aabbccddeeff00112233445566778899';

const pngHeader = (width: number, height: number): Uint8Array => {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf[11] = 13;
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  buf[19] = width;
  buf[23] = height;
  return buf;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const client = (fetcher: typeof fetch, apiRoot = API_ROOT): YggdrasilTexturesClient =>
  new YggdrasilTexturesClient({ apiRoot, fetch: fetcher });

const firstInit = (fetcher: ReturnType<typeof vi.fn>): RequestInit => {
  const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
  if (!init) throw new Error('fetcher was not called with an init');
  return init;
};

describe('getTextures', () => {
  it('undashes the uuid and reads the top-level /textures mount', async () => {
    const body = { skin: { url: '/textures/skin.png', variant: 'SLIM' }, cape: null };
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(body));
    expect(await client(fetcher).getTextures(DASHED)).toEqual(body);
    expect(fetcher).toHaveBeenCalledWith(
      `${API_ROOT}/textures/${UNDASHED}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('trims a trailing slash off apiRoot instead of doubling it', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ skin: null, cape: null }));
    await client(fetcher, `${API_ROOT}/`).getTextures(UNDASHED);
    expect(fetcher).toHaveBeenCalledWith(
      `${API_ROOT}/textures/${UNDASHED}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws invalid_response when the body fails the schema', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ skin: { url: '' }, cape: null }),
    );
    await expect(client(fetcher).getTextures(UNDASHED)).rejects.toMatchObject({
      code: YggdrasilErrorCodes.INVALID_RESPONSE,
    });
  });

  it('wraps a fetch rejection as network', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('connect failed');
    });
    const error = await client(fetcher)
      .getTextures(UNDASHED)
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(YggdrasilError);
    expect((error as YggdrasilError).code).toBe(YggdrasilErrorCodes.NETWORK);
    expect((error as YggdrasilError).cause).toBeInstanceOf(TypeError);
  });

  it('attaches status and the parsed error envelope on an HTTP failure', async () => {
    const envelope = { error: 'ForbiddenOperationException', errorMessage: 'Invalid token' };
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(envelope, 403));
    const error = await client(fetcher)
      .getTextures(UNDASHED)
      .catch((err: unknown) => err);
    expect((error as YggdrasilError).code).toBe(YggdrasilErrorCodes.HTTP_ERROR);
    expect((error as YggdrasilError).context).toEqual({
      status: 403,
      url: `${API_ROOT}/textures/${UNDASHED}`,
      body: envelope,
    });
  });

  it('leaves a non-Yggdrasil body (edge-proxy HTML) out of the error context', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );
    const error = await client(fetcher)
      .getTextures(UNDASHED)
      .catch((err: unknown) => err);
    expect((error as YggdrasilError).context).toEqual({
      status: 502,
      url: `${API_ROOT}/textures/${UNDASHED}`,
    });
  });
});

describe('uploadSkin / uploadCape', () => {
  it('PUTs the file as multipart with the bearer and the variant field', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await client(fetcher).uploadSkin({
      accessToken: 'sess-token',
      file: pngHeader(64, 64),
      variant: 'SLIM',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${API_ROOT}/textures/skin`);
    const init = firstInit(fetcher);
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sess-token' });
    // fetch must own the multipart boundary, so no explicit content-type.
    expect(JSON.stringify(init.headers)).not.toContain('content-type');
    const form = init.body as FormData;
    expect(form.get('variant')).toBe('SLIM');
    expect((form.get('file') as File).type).toBe('image/png');
  });

  it('defaults the variant to CLASSIC', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await client(fetcher).uploadSkin({ accessToken: 't', file: pngHeader(64, 64) });
    expect((firstInit(fetcher).body as FormData).get('variant')).toBe('CLASSIC');
  });

  it('rejects a malformed PNG before issuing any request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      client(fetcher).uploadSkin({ accessToken: 't', file: new Uint8Array(24) }),
    ).rejects.toMatchObject({ code: YggdrasilErrorCodes.INVALID_PNG });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a 64x64 cape (capes are 64x32 only)', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      client(fetcher).uploadCape({ accessToken: 't', file: pngHeader(64, 64) }),
    ).rejects.toMatchObject({ code: YggdrasilErrorCodes.INVALID_PNG });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a 64x32 cape and PUTs it without a variant', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await client(fetcher).uploadCape({ accessToken: 't', file: pngHeader(64, 32) });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${API_ROOT}/textures/cape`);
    expect((firstInit(fetcher).body as FormData).get('variant')).toBeNull();
  });
});

describe('deleteSkin / deleteCape', () => {
  it('DELETEs the skin and cape endpoints with the bearer', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const textures = client(fetcher);
    await textures.deleteSkin({ accessToken: 'sess-token' });
    await textures.deleteCape({ accessToken: 'sess-token' });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `${API_ROOT}/textures/skin`,
      `${API_ROOT}/textures/cape`,
    ]);
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({
        method: 'DELETE',
        headers: { authorization: 'Bearer sess-token' },
      });
    }
  });
});
