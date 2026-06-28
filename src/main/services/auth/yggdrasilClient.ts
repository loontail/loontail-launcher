import { type TexturesLookupResponse, YggdrasilClient } from '@loontail/yggdrasil-client';
import { mainConfig } from '@main/config';

export type FetchTextures = (uuid: string) => Promise<TexturesLookupResponse>;

export type YggdrasilGateway = {
  // Rooted at the bare API origin so texture calls resolve to
  // `${apiUrl}/textures/...`. Use ONLY for the texture methods
  // (getTextures/uploadSkin/uploadCape/deleteSkin/deleteCape); the
  // authenticate/refresh/validate/invalidate/profile/bulkProfiles methods build
  // paths the backend mounts under `/api/yggdrasil/*` and would 404 here.
  readonly texturesClient: YggdrasilClient;
  readonly fetchTextures: FetchTextures;
};

export const createYggdrasilClient = (deps: { fetch?: typeof fetch } = {}): YggdrasilGateway => {
  // Textures are served at the API origin's top-level `/textures`; point the
  // client at the bare `apiUrl` so skin/cape upload, lookup, and delete resolve
  // to `${apiUrl}/textures/...`.
  const texturesClient = new YggdrasilClient(
    deps.fetch ? { apiRoot: mainConfig.apiUrl, fetch: deps.fetch } : { apiRoot: mainConfig.apiUrl },
  );

  // `GET /textures/:uuid` may return relative URLs; resolve any non-http(s) URL
  // against `mainConfig.apiUrl` so downstream consumers receive a fully-qualified
  // URL they can hand to `fetch`.
  const absolutizeTextureUrl = (url: string): string => {
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, mainConfig.apiUrl).toString();
  };

  const fetchTextures: FetchTextures = async (uuid) => {
    const result = await texturesClient.getTextures(uuid);
    return {
      skin: result.skin ? { ...result.skin, url: absolutizeTextureUrl(result.skin.url) } : null,
      cape: result.cape ? { ...result.cape, url: absolutizeTextureUrl(result.cape.url) } : null,
    };
  };

  return { texturesClient, fetchTextures };
};
