import { type TexturesLookupResponse, YggdrasilClient } from '@loontail/yggdrasil-client';
import { mainConfig } from '@main/config';

export type FetchTextures = (uuid: string) => Promise<TexturesLookupResponse>;

// The Yggdrasil client plus its launcher-aware texture lookup, created once and
// threaded through the auth and skin services like `kit` — never a module
// singleton, so tests can swap in a fake per service.
export type YggdrasilGateway = {
  readonly client: YggdrasilClient;
  readonly fetchTextures: FetchTextures;
};

export const createYggdrasilClient = (): YggdrasilGateway => {
  const client = new YggdrasilClient({ apiRoot: mainConfig.yggdrasilApiRoot });

  // `GET /api/yggdrasil/textures/:uuid` may return relative URLs depending on
  // how the server is configured (the convenience endpoint doesn't prepend
  // `publicUrl` the way the signed `textures` property does). Resolve any
  // non-http(s) URL against `mainConfig.apiUrl` so consumers downstream — the
  // skinview3d viewer, the media cache — receive a fully-qualified URL they
  // can hand to `fetch`.
  const absolutizeTextureUrl = (url: string): string => {
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, mainConfig.apiUrl).toString();
  };

  const fetchTextures: FetchTextures = async (uuid) => {
    const result = await client.getTextures(uuid);
    return {
      skin: result.skin ? { ...result.skin, url: absolutizeTextureUrl(result.skin.url) } : null,
      cape: result.cape ? { ...result.cape, url: absolutizeTextureUrl(result.cape.url) } : null,
    };
  };

  return { client, fetchTextures };
};
