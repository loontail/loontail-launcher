import type { ClientSlug } from '@shared/contracts/ids';
import type { ClientSettingsOverride, LauncherSettings } from '@shared/contracts/settings';
import { joinClientFolder } from './settingsDefaults';

export const hasClientOverrides = (override: ClientSettingsOverride | undefined): boolean => {
  if (!override) return false;
  const memoryEmpty = !override.memory || Object.keys(override.memory).length === 0;
  const storageEmpty = !override.storage || Object.keys(override.storage).length === 0;
  const launchEmpty = !override.launch || Object.keys(override.launch).length === 0;
  const runtimeEmpty = !override.runtime;
  const loaderEmpty = !override.loader;
  return !(memoryEmpty && storageEmpty && launchEmpty && runtimeEmpty && loaderEmpty);
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
  if (override.loader) out.loader = override.loader;
  return out;
};

export const setClientOverride = (
  settings: LauncherSettings,
  slug: ClientSlug,
  patch: ClientSettingsOverride,
): LauncherSettings => {
  const existing = settings.clients[slug] ?? {};
  const merged: ClientSettingsOverride = {
    memory: { ...existing.memory, ...patch.memory },
    storage: { ...existing.storage, ...patch.storage },
    launch: { ...existing.launch, ...patch.launch },
    runtime: 'runtime' in patch ? patch.runtime : existing.runtime,
    loader: 'loader' in patch ? patch.loader : existing.loader,
  };

  if (
    merged.memory &&
    typeof merged.memory.allocatedRamMb === 'number' &&
    merged.memory.allocatedRamMb === settings.memory.allocatedRamMb
  ) {
    delete merged.memory.allocatedRamMb;
  }

  if (merged.storage && typeof merged.storage.clientFolder === 'string') {
    const defaultClientFolder = joinClientFolder(settings.storage.clientsFolder, slug);
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
    clients[slug] = compact;
  } else {
    delete clients[slug];
  }
  return { ...settings, clients };
};

export const clearClientOverrides = (
  settings: LauncherSettings,
  slug: ClientSlug,
): LauncherSettings => {
  const existing = settings.clients[slug];
  if (!existing) return settings;
  const clients = { ...settings.clients };
  if (existing.runtime) {
    clients[slug] = { runtime: existing.runtime };
  } else {
    delete clients[slug];
  }
  return { ...settings, clients };
};

export const clearStaleClientRuntimeRef = (
  settings: LauncherSettings,
  slug: ClientSlug,
  runtimeComponent: string,
): LauncherSettings => {
  const runtime = settings.clients[slug]?.runtime;
  if (!runtime || runtime.component === runtimeComponent) return settings;
  return setClientOverride(settings, slug, { runtime: undefined });
};

export const pruneClientOverrides = (
  settings: LauncherSettings,
  keepSlugs: ReadonlySet<string>,
): LauncherSettings => {
  const next: Record<string, ClientSettingsOverride> = {};
  let removed = false;
  for (const [slug, override] of Object.entries(settings.clients)) {
    // override is typed `| undefined` under noUncheckedIndexedAccess; the guard
    // both narrows it and drops any stray undefined entry from the rebuilt map.
    if (override === undefined) {
      removed = true;
      continue;
    }
    if (keepSlugs.has(slug)) {
      next[slug] = override;
    } else {
      removed = true;
    }
  }
  return removed ? { ...settings, clients: next } : settings;
};
