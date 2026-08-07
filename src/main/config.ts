// These env vars are inlined at build time by electron-vite's `define` block.
// Vite only substitutes literal property accesses, so each read must use
// `process.env.<NAME>` directly — `process.env[name]` would be undefined in the
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
  // Base URL of the in-game network service, handed to the in-game network mod
  // via a -D property at launch. Blank is the documented opt-out: no URL is
  // injected and the launch path also withholds the API session bearer, so the
  // mod stays offline and no game JVM sees a credential.
  networkServiceUrl: optionalEnv(process.env.NETWORK_API_URL),
} as const;

export type MainConfig = typeof mainConfig;

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// API_URL and NETWORK_API_URL address one unified backend. The API session
// bearer is minted by API_URL and only that origin accepts it, so a divergence
// 401s every in-game network call with no other symptom — surface it at startup
// instead of letting it fail silently in the game.
export const configWarnings = (
  config: Pick<MainConfig, 'apiUrl' | 'networkServiceUrl'>,
): readonly string[] => {
  const { networkServiceUrl } = config;
  if (!networkServiceUrl) return [];
  const networkOrigin = originOf(networkServiceUrl);
  if (networkOrigin === null) {
    return [`NETWORK_API_URL is not a valid URL (${networkServiceUrl}); the network mod will fail`];
  }
  const apiOrigin = originOf(config.apiUrl) ?? config.apiUrl;
  if (networkOrigin === apiOrigin) return [];
  return [
    `NETWORK_API_URL origin ${networkOrigin} differs from API_URL origin ${apiOrigin}; the API session bearer is only accepted by the API_URL origin, so every in-game network call will fail with 401`,
  ];
};
