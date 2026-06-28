import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression guard for the skin/cape 404: textures must resolve to the API's
// top-level `/textures`, NOT the stale Strapi-era `/api/yggdrasil/textures`.
vi.mock('@main/config', () => ({
  mainConfig: {
    apiUrl: 'https://api.test.invalid',
    yggdrasilApiRoot: 'https://api.test.invalid/api/yggdrasil',
  },
}));

import { createYggdrasilClient } from '@main/services/auth/yggdrasilClient';

describe('createYggdrasilClient — textures base', () => {
  const calls: { url: string; method: string }[] = [];
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() });
    return new Response(JSON.stringify({ skin: null, cape: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  beforeEach(() => {
    calls.length = 0;
    fakeFetch.mockClear();
  });

  it('resolves the texture lookup to top-level /textures/:uuid (undashed)', async () => {
    const gateway = createYggdrasilClient({ fetch: fakeFetch as unknown as typeof fetch });
    await gateway.fetchTextures('f84c6a79-0a4e-45e0-879f-0e478de5cb7e');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.test.invalid/textures/f84c6a790a4e45e0879f0e478de5cb7e',
    );
    expect(calls[0]?.url).not.toContain('/api/yggdrasil/textures');
  });

  it('resolves skin/cape delete to top-level /textures/{skin,cape}', async () => {
    const gateway = createYggdrasilClient({ fetch: fakeFetch as unknown as typeof fetch });
    await gateway.texturesClient.deleteSkin({ accessToken: 'token' });
    await gateway.texturesClient.deleteCape({ accessToken: 'token' });

    const urls = calls.map((c) => c.url);
    expect(urls).toContain('https://api.test.invalid/textures/skin');
    expect(urls).toContain('https://api.test.invalid/textures/cape');
    expect(urls.every((u) => !u.includes('/api/yggdrasil/textures'))).toBe(true);
  });
});
