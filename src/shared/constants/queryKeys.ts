export const QUERY_KEYS = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  app: {
    version: ['app', 'version'] as const,
  },
  catalog: {
    list: (locale: string) => ['catalog', 'list', locale] as const,
  },
  builds: {
    minecraftVersions: ['builds', 'minecraftVersions'] as const,
    loaderVersions: (loader: string, minecraftVersion: string) =>
      ['builds', 'loaderVersions', loader, minecraftVersion] as const,
  },
  servers: {
    statuses: (addressesKey: string) => ['servers', 'statuses', addressesKey] as const,
  },
  history: {
    lastPlayed: ['history', 'lastPlayed'] as const,
  },
  settings: {
    root: ['settings'] as const,
  },
  system: {
    ramRange: ['system', 'ramRange'] as const,
    diskSpaceRoot: ['system', 'diskSpace'] as const,
    diskSpace: (path: string) => ['system', 'diskSpace', path] as const,
    folderSizeRoot: ['system', 'folderSize'] as const,
    folderSize: (path: string) => ['system', 'folderSize', path] as const,
    defaultInstallFolder: ['system', 'defaultInstallFolder'] as const,
  },
  media: {
    cacheSize: ['media', 'cacheSize'] as const,
  },
} as const;

export const QUERY_KEY_ROOTS = {
  auth: 'auth',
  app: 'app',
  catalog: 'catalog',
  builds: 'builds',
  servers: 'servers',
  history: 'history',
  settings: 'settings',
  system: 'system',
  media: 'media',
} as const satisfies Record<string, string>;
