// `process.env.API_URL` / `process.env.MOJANG_CLIENT_ID`
// / `process.env.YGGDRASIL_API_ROOT` are inlined at build time by
// `electron-vite.config.ts` (the `define` block). Vite only substitutes literal
// property accesses, so each read must use `process.env.<NAME>` directly — a
// helper like `process.env[name]` would leave the value undefined in the
// packaged main bundle.
const requireEnv = (name: string, value: string | undefined): string => {
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const optionalEnv = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const apiUrl = requireEnv('API_URL', process.env.API_URL);
const yggdrasilApiRoot = optionalEnv(process.env.YGGDRASIL_API_ROOT) ?? `${apiUrl}/api/yggdrasil`;

export const mainConfig = {
  apiUrl,
  mojangClientId: optionalEnv(process.env.MOJANG_CLIENT_ID),
  yggdrasilApiRoot,
  // Base URL of the Loontail in-game network service the embedded agent connects to.
  // Optional: when unset the agent uses its built-in default (no network features).
  networkServiceUrl: optionalEnv(process.env.NETWORK_API_URL),
} as const;
