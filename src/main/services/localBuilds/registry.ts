import { getStoredLocalBuildRegistry, setStoredLocalBuildRegistry } from '@main/infra/store';
import type { LocalBuildId } from '@shared/contracts/ids';
import {
  INSTANCE_REGISTRY_SCHEMA_VERSION,
  type LocalBuildRegistryEntry,
} from '@shared/contracts/localBuild';

// The persisted index is a fast-lookup cache; the authoritative descriptor is
// each local build's `instance.json`, so a lost or corrupt index is recoverable by
// rescanning the install root (see ./reconcile).
export const listLocalBuildEntries = (): LocalBuildRegistryEntry[] =>
  getStoredLocalBuildRegistry().instances;

export const getLocalBuildEntry = (id: LocalBuildId): LocalBuildRegistryEntry | undefined =>
  listLocalBuildEntries().find((entry) => entry.id === id);

export const upsertLocalBuildEntry = (entry: LocalBuildRegistryEntry): void => {
  const entries = listLocalBuildEntries().filter((existing) => existing.id !== entry.id);
  entries.push(entry);
  setStoredLocalBuildRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};

export const removeLocalBuildEntry = (id: LocalBuildId): void => {
  const entries = listLocalBuildEntries().filter((existing) => existing.id !== id);
  setStoredLocalBuildRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};

export const replaceLocalBuildEntries = (entries: LocalBuildRegistryEntry[]): void => {
  setStoredLocalBuildRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};
