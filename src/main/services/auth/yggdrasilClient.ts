import { type TexturesLookupResponse, YggdrasilClient } from '@loontail/yggdrasil-client';
import { mainConfig } from '@main/config';

let cached: YggdrasilClient | null = null;

export const getYggdrasilClient = (): YggdrasilClient => {
  if (!cached) {
    cached = new YggdrasilClient({ apiRoot: mainConfig.yggdrasilApiRoot });
  }
  return cached;
};

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

export const fetchTextures = async (uuid: string): Promise<TexturesLookupResponse> => {
  const result = await getYggdrasilClient().getTextures(uuid);
  return {
    skin: result.skin ? { ...result.skin, url: absolutizeTextureUrl(result.skin.url) } : null,
    cape: result.cape ? { ...result.cape, url: absolutizeTextureUrl(result.cape.url) } : null,
  };
};
