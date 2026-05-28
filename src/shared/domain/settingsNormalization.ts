import {
  type ClientRuntimeRef,
  type ClientSettingsOverride,
  type LauncherSettings,
  type LoaderChoice,
  LoaderChoices,
} from '@shared/contracts/settings';
import { defaultLauncherSettings } from './settingsDefaults';

const normalizeRuntimeRef = (value: unknown): ClientRuntimeRef | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.component !== 'string' || typeof raw.path !== 'string') return undefined;
  return { component: raw.component, path: raw.path };
};

const LOADER_VALUES: ReadonlySet<string> = new Set(Object.values(LoaderChoices));

const normalizeLoaderChoice = (value: unknown): LoaderChoice | undefined =>
  typeof value === 'string' && LOADER_VALUES.has(value) ? (value as LoaderChoice) : undefined;

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
    const outLaunch: { console?: boolean; fullscreen?: boolean } = {};
    if (typeof launch.console === 'boolean') outLaunch.console = launch.console;
    if (typeof launch.fullscreen === 'boolean') outLaunch.fullscreen = launch.fullscreen;
    if (Object.keys(outLaunch).length > 0) out.launch = outLaunch;
  }

  const runtime = normalizeRuntimeRef(raw.runtime);
  if (runtime) out.runtime = runtime;

  const loader = normalizeLoaderChoice(raw.loader);
  if (loader) out.loader = loader;

  return out;
};

export const normalizeLauncherSettings = (value: unknown): LauncherSettings => {
  const base = defaultLauncherSettings();
  if (!value || typeof value !== 'object') return base;
  const rawSettings = value as Partial<LauncherSettings>;

  const memory =
    rawSettings.memory && typeof rawSettings.memory === 'object' ? rawSettings.memory : null;
  const storage =
    rawSettings.storage && typeof rawSettings.storage === 'object' ? rawSettings.storage : null;
  const launch =
    rawSettings.launch && typeof rawSettings.launch === 'object' ? rawSettings.launch : null;
  const rawClients =
    rawSettings.clients && typeof rawSettings.clients === 'object' ? rawSettings.clients : {};

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
