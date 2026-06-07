import { getStoredInstanceRegistry, setStoredInstanceRegistry } from '@main/infra/store';
import type { InstanceId } from '@shared/contracts/ids';
import {
  INSTANCE_REGISTRY_SCHEMA_VERSION,
  type InstanceRegistryEntry,
} from '@shared/contracts/instance';

// Thin business layer over the persisted local-build index. The index is a
// fast-lookup cache (id/name/dir/updatedAt); the authoritative descriptor is
// each instance's `instance.json`, so a lost or corrupt index is recoverable by
// rescanning the install root (see reconcile in ./reconcile).

export const listInstanceEntries = (): InstanceRegistryEntry[] =>
  getStoredInstanceRegistry().instances;

export const getInstanceEntry = (id: InstanceId): InstanceRegistryEntry | undefined =>
  listInstanceEntries().find((entry) => entry.id === id);

export const upsertInstanceEntry = (entry: InstanceRegistryEntry): void => {
  const entries = listInstanceEntries().filter((existing) => existing.id !== entry.id);
  entries.push(entry);
  setStoredInstanceRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};

export const removeInstanceEntry = (id: InstanceId): void => {
  const entries = listInstanceEntries().filter((existing) => existing.id !== id);
  setStoredInstanceRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};

export const replaceInstanceEntries = (entries: InstanceRegistryEntry[]): void => {
  setStoredInstanceRegistry({ schema: INSTANCE_REGISTRY_SCHEMA_VERSION, instances: entries });
};
