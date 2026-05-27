// `process.env.API_URL` / `process.env.API_TOKEN` / `process.env.MOJANG_CLIENT_ID`
// / `process.env.YGGDRASIL_API_ROOT` / `process.env.YGGDRASIL_GAME_API_ROOT` are
// inlined at build time by `electron-vite.config.ts` (the `define` block). Vite
// only substitutes literal property accesses, so each read must use
// `process.env.<NAME>` directly — a helper like `process.env[name]` would leave
// the value undefined in the packaged main bundle.
const requireEnv = (name: string, value: string | undefined): string => {
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const optionalEnv = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const apiUrl = requireEnv('API_URL', process.env.API_URL);

// URL the launcher's own Node-side fetches against Yggdrasil endpoints
// (authenticate, refresh, validate, getTextures, uploadSkin, …). Defaults to
// the same origin as the rest of the Strapi API — kept on plain `API_URL` in
// dev so Node-side fetch doesn't have to trust a self-signed mkcert chain.
const yggdrasilApiRoot = optionalEnv(process.env.YGGDRASIL_API_ROOT) ?? `${apiUrl}/api/yggdrasil`;

// URL the launcher bakes into the `-javaagent:authlib-injector.jar=<here>`
// JVM argument. The vanilla Minecraft client + authlib-injector connect to
// this URL for online-mode auth, so a production-style HTTPS endpoint is
// expected here even in dev (e.g. a `local-ssl-proxy` in front of Strapi
// terminating TLS). Falls back to `yggdrasilApiRoot` when no override is
// given, so single-URL deployments don't need to set this.
const yggdrasilGameApiRoot = optionalEnv(process.env.YGGDRASIL_GAME_API_ROOT) ?? yggdrasilApiRoot;

export const mainConfig = {
  apiUrl,
  apiToken: requireEnv('API_TOKEN', process.env.API_TOKEN),
  mojangClientId: optionalEnv(process.env.MOJANG_CLIENT_ID),
  yggdrasilApiRoot,
  yggdrasilGameApiRoot,
} as const;
