import type {
  ClientRuntimeRef,
  ClientSettingsOverride,
  LauncherSettings,
  ResolvedClientSettings,
} from '@shared/contracts/settings';

export const defaultLauncherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

export const joinClientFolder = (clientsFolder: string, bundleSlug: string): string => {
  if (!clientsFolder) return '';
  const separator = clientsFolder.endsWith('/') || clientsFolder.endsWith('\\') ? '' : '/';
  return `${clientsFolder}${separator}${bundleSlug}`;
};

const normalizeRuntimeRef = (value: unknown): ClientRuntimeRef | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.component !== 'string' || typeof raw.path !== 'string') return undefined;
  return { component: raw.component, path: raw.path };
};

const normalizeClientOverride = (value: unknown): ClientSettingsOverride => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const out: ClientSettingsOverride = {};

  if (raw.memory && typeof raw.memory === 'object') {
    const memory = raw.memory as Record<string, unknown>;
    if (typeof memory.allocatedRamMb === 'number') {
      out.memory = { allocatedRamMb: memory.allocatedRamMb };
    }
  }

  if (raw.storage && typeof raw.storage === 'object') {
    const storage = raw.storage as Record<string, unknown>;
    if (typeof storage.clientFolder === 'string') {
      out.storage = { clientFolder: storage.clientFolder };
    }
  }

  if (raw.launch && typeof raw.launch === 'object') {
    const launch = raw.launch as Record<string, unknown>;
    const lo: { console?: boolean; fullscreen?: boolean } = {};
    if (typeof launch.console === 'boolean') lo.console = launch.console;
    if (typeof launch.fullscreen === 'boolean') lo.fullscreen = launch.fullscreen;
    if (Object.keys(lo).length > 0) out.launch = lo;
  }

  const runtime = normalizeRuntimeRef(raw.runtime);
  if (runtime) out.runtime = runtime;

  return out;
};

export const normalizeLauncherSettings = (value: unknown): LauncherSettings => {
  const base = defaultLauncherSettings();
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<LauncherSettings>;

  const memory = v.memory && typeof v.memory === 'object' ? v.memory : null;
  const storage = v.storage && typeof v.storage === 'object' ? v.storage : null;
  const launch = v.launch && typeof v.launch === 'object' ? v.launch : null;
  const rawClients = v.clients && typeof v.clients === 'object' ? v.clients : {};

  const clients: Record<string, ClientSettingsOverride> = {};
  for (const [slug, override] of Object.entries(rawClients)) {
    if (slug && slug !== 'undefined' && slug !== 'null') {
      clients[slug] = normalizeClientOverride(override);
    }
  }

  return {
    memory: {
      allocatedRamMb:
        typeof memory?.allocatedRamMb === 'number'
          ? memory.allocatedRamMb
          : base.memory.allocatedRamMb,
    },
    storage: {
      clientsFolder:
        typeof storage?.clientsFolder === 'string'
          ? storage.clientsFolder
          : base.storage.clientsFolder,
    },
    launch: {
      console: typeof launch?.console === 'boolean' ? launch.console : base.launch.console,
      fullscreen:
        typeof launch?.fullscreen === 'boolean' ? launch.fullscreen : base.launch.fullscreen,
    },
    clients,
  };
};

export const resolveClientSettings = (
  settings: LauncherSettings,
  bundleSlug: string | null | undefined,
): ResolvedClientSettings => {
  const override: ClientSettingsOverride =
    bundleSlug && settings.clients[bundleSlug] ? settings.clients[bundleSlug] : {};

  const ram =
    typeof override.memory?.allocatedRamMb === 'number'
      ? override.memory.allocatedRamMb
      : settings.memory.allocatedRamMb;

  const defaultClientFolder = bundleSlug
    ? joinClientFolder(settings.storage.clientsFolder, bundleSlug)
    : '';
  const clientFolder = override.storage?.clientFolder ?? defaultClientFolder;

  const consoleVal =
    typeof override.launch?.console === 'boolean'
      ? override.launch.console
      : settings.launch.console;
  const fullscreenVal =
    typeof override.launch?.fullscreen === 'boolean'
      ? override.launch.fullscreen
      : settings.launch.fullscreen;

  return {
    memory: { allocatedRamMb: ram },
    storage: { clientsFolder: settings.storage.clientsFolder, clientFolder },
    launch: { console: consoleVal, fullscreen: fullscreenVal },
    diff: {
      ram: ram !== settings.memory.allocatedRamMb,
      folder: clientFolder !== defaultClientFolder,
      console: consoleVal !== settings.launch.console,
      fullscreen: fullscreenVal !== settings.launch.fullscreen,
    },
  };
};

export const hasClientOverrides = (override: ClientSettingsOverride | undefined): boolean => {
  if (!override) return false;
  const memEmpty = !override.memory || Object.keys(override.memory).length === 0;
  const stoEmpty = !override.storage || Object.keys(override.storage).length === 0;
  const lauEmpty = !override.launch || Object.keys(override.launch).length === 0;
  const runtimeEmpty = !override.runtime;
  return !(memEmpty && stoEmpty && lauEmpty && runtimeEmpty);
};

const compactOverride = (override: ClientSettingsOverride): ClientSettingsOverride => {
  const out: ClientSettingsOverride = {};
  if (override.memory && Object.keys(override.memory).length > 0) {
    out.memory = { ...override.memory };
  }
  if (override.storage && Object.keys(override.storage).length > 0) {
    out.storage = { ...override.storage };
  }
  if (override.launch && Object.keys(override.launch).length > 0) {
    out.launch = { ...override.launch };
  }
  if (override.runtime) out.runtime = { ...override.runtime };
  return out;
};

export const setClientOverride = (
  settings: LauncherSettings,
  bundleSlug: string,
  patch: ClientSettingsOverride,
): LauncherSettings => {
  const existing = settings.clients[bundleSlug] ?? {};
  const merged: ClientSettingsOverride = {
    memory: { ...existing.memory, ...patch.memory },
    storage: { ...existing.storage, ...patch.storage },
    launch: { ...existing.launch, ...patch.launch },
    runtime: patch.runtime ?? existing.runtime,
  };

  if (
    merged.memory &&
    typeof merged.memory.allocatedRamMb === 'number' &&
    merged.memory.allocatedRamMb === settings.memory.allocatedRamMb
  ) {
    delete merged.memory.allocatedRamMb;
  }

  if (merged.storage && typeof merged.storage.clientFolder === 'string') {
    const defaultClientFolder = joinClientFolder(settings.storage.clientsFolder, bundleSlug);
    if (merged.storage.clientFolder === defaultClientFolder) {
      delete merged.storage.clientFolder;
    }
  }

  if (
    merged.launch &&
    typeof merged.launch.console === 'boolean' &&
    merged.launch.console === settings.launch.console
  ) {
    delete merged.launch.console;
  }

  if (
    merged.launch &&
    typeof merged.launch.fullscreen === 'boolean' &&
    merged.launch.fullscreen === settings.launch.fullscreen
  ) {
    delete merged.launch.fullscreen;
  }

  const compact = compactOverride(merged);
  const clients = { ...settings.clients };
  if (hasClientOverrides(compact)) {
    clients[bundleSlug] = compact;
  } else {
    delete clients[bundleSlug];
  }
  return { ...settings, clients };
};

export const clearClientOverrides = (
  settings: LauncherSettings,
  bundleSlug: string,
): LauncherSettings => {
  const existing = settings.clients[bundleSlug];
  if (!existing) return settings;
  const clients = { ...settings.clients };
  if (existing.runtime) {
    clients[bundleSlug] = { runtime: existing.runtime };
  } else {
    delete clients[bundleSlug];
  }
  return { ...settings, clients };
};

export const removeClientEntry = (
  settings: LauncherSettings,
  bundleSlug: string,
): LauncherSettings => {
  if (!settings.clients[bundleSlug]) return settings;
  const clients = { ...settings.clients };
  delete clients[bundleSlug];
  return { ...settings, clients };
};
