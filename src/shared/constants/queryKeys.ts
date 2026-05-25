export const QUERY_KEYS = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  app: {
    version: ['app', 'version'] as const,
  },
  clients: {
    list: (locale: string) => ['clients', 'list', locale] as const,
  },
  servers: {
    statuses: (addressesKey: string) => ['servers', 'statuses', addressesKey] as const,
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
  },
  media: {
    cacheSize: ['media', 'cacheSize'] as const,
  },
} as const;

export const QUERY_KEY_ROOTS = {
  auth: 'auth',
  app: 'app',
  clients: 'clients',
  servers: 'servers',
  settings: 'settings',
  system: 'system',
  media: 'media',
} as const satisfies Record<string, string>;
