// `process.env.API_URL` / `process.env.API_TOKEN` are inlined at build time by
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

export const mainConfig = {
  apiUrl: requireEnv('API_URL', process.env.API_URL),
  apiToken: requireEnv('API_TOKEN', process.env.API_TOKEN),
} as const;
