import fs from 'node:fs/promises';
import path from 'node:path';
import { scopedLogger } from '@main/infra/logger';
import { getSettings } from '@main/services/settings/settings';
import type { InstanceRegistryEntry } from '@shared/contracts/instance';
import { loadInstanceManifest } from './instanceRepo';
import { listInstanceEntries, replaceInstanceEntries } from './registry';

const logger = scopedLogger('instances.reconcile');

const entryFromManifest = (
  dir: string,
  manifest: { id: InstanceRegistryEntry['id']; name: string; updatedAt: string },
): InstanceRegistryEntry => ({
  id: manifest.id,
  name: manifest.name,
  dir,
  updatedAt: manifest.updatedAt,
});

// Best-effort self-heal run at startup. Drops registry entries whose
// `instance.json` no longer loads (a manually deleted/renamed folder) and
// re-discovers any instances under the install root that are missing from the
// index (recovered from a corrupt or wiped registry). Official build folders
// have no `instance.json`, so they are ignored. Never throws — a reconcile
// failure must not crash bootstrap.
export const reconcileRegistry = async (): Promise<void> => {
  try {
    const byDir = new Map<string, InstanceRegistryEntry>();

    for (const entry of listInstanceEntries()) {
      const manifest = await loadInstanceManifest(entry.dir);
      if (manifest) byDir.set(entry.dir, entryFromManifest(entry.dir, manifest));
    }

    const clientsFolder = getSettings().storage.clientsFolder;
    if (clientsFolder) {
      let children: string[] = [];
      try {
        children = await fs.readdir(clientsFolder);
      } catch {
        children = [];
      }
      for (const child of children) {
        const dir = path.join(clientsFolder, child);
        if (byDir.has(dir)) continue;
        const manifest = await loadInstanceManifest(dir);
        if (manifest) byDir.set(dir, entryFromManifest(dir, manifest));
      }
    }

    replaceInstanceEntries([...byDir.values()]);
  } catch (error) {
    logger.warn('Failed to reconcile instance registry', error);
  }
};
