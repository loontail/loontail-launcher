import { type TexturesLookupResponse, YggdrasilClient } from '@loontail/yggdrasil-client';
import { mainConfig } from '@main/config';

export type FetchTextures = (uuid: string) => Promise<TexturesLookupResponse>;

// The Yggdrasil texture client plus its launcher-aware lookup, created once and
// threaded through the auth and skin services like `kit` — never a module
// singleton, so tests can swap in a fake per service.
export type YggdrasilGateway = {
  readonly texturesClient: YggdrasilClient;
  readonly fetchTextures: FetchTextures;
};

export const createYggdrasilClient = (deps: { fetch?: typeof fetch } = {}): YggdrasilGateway => {
  // Textures are served at the API origin's top-level `/textures` (the server
  // mounts the textures router there; `/api/yggdrasil/textures` only exists as a
  // back-compat alias for older launchers). Point the client at the bare
  // `apiUrl` so skin/cape upload, lookup, and delete resolve to
  // `${apiUrl}/textures/...` instead of the stale CMS-era
  // `${apiUrl}/api/yggdrasil/textures/...` path, which the new API 404s.
  // (The game's authlib-injector still targets `yggdrasilApiRoot` directly in
  // the launch args — that's a separate, server-side concern.)
  const texturesClient = new YggdrasilClient(
    deps.fetch ? { apiRoot: mainConfig.apiUrl, fetch: deps.fetch } : { apiRoot: mainConfig.apiUrl },
  );

  // `GET /textures/:uuid` may return relative URLs depending on how the server
  // is configured (the convenience endpoint doesn't prepend `publicUrl` the way
  // the signed `textures` property does). Resolve any non-http(s) URL against
  // `mainConfig.apiUrl` so consumers downstream — the skinview3d viewer, the
  // media cache — receive a fully-qualified URL they can hand to `fetch`.
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
