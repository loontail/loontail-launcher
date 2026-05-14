export const mainConfig = {
  apiUrl: process.env.API_URL ?? '',
  apiToken: process.env.API_TOKEN ?? '',
} as const;
