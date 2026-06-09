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
    // Keyed by manifest id, not dir: the stored dir and the rediscovered dir can
    // spell the same path differently (joinClientFolder uses '/', path.join uses
    // the OS separator), so a dir-keyed map would duplicate every instance. The
    // id is canonical, so this also collapses any already-corrupt double entries.
    const byId = new Map<string, InstanceRegistryEntry>();

    for (const entry of listInstanceEntries()) {
      const manifest = await loadInstanceManifest(entry.dir);
      if (manifest) byId.set(manifest.id, entryFromManifest(entry.dir, manifest));
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
        const manifest = await loadInstanceManifest(dir);
        if (manifest && !byId.has(manifest.id)) {
          byId.set(manifest.id, entryFromManifest(dir, manifest));
        }
      }
    }

    replaceInstanceEntries([...byId.values()]);
  } catch (error) {
    logger.warn('Failed to reconcile instance registry', error);
  }
};
