import { mainConfig } from '@main/config';
import {
  type TexturesLookupResponse,
  YggdrasilTexturesClient,
} from '@main/services/yggdrasil/texturesClient';

export type FetchTextures = (uuid: string) => Promise<TexturesLookupResponse>;

export type YggdrasilGateway = {
  // Rooted at the bare API origin so texture calls resolve to
  // `${apiUrl}/textures/...`, NOT the `/api/yggdrasil/*` mount the auth half
  // of the protocol lives under.
  readonly texturesClient: YggdrasilTexturesClient;
  readonly fetchTextures: FetchTextures;
};

export const createYggdrasilClient = (deps: { fetch?: typeof fetch } = {}): YggdrasilGateway => {
  // Textures are served at the API origin's top-level `/textures`; point the
  // client at the bare `apiUrl` so skin/cape upload, lookup, and delete resolve
  // to `${apiUrl}/textures/...`.
  const texturesClient = new YggdrasilTexturesClient(
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
