import fs from 'node:fs/promises';
import path from 'node:path';
import { scopedLogger } from '@main/infra/logger';
import { getSettings } from '@main/services/settings/settings';
import type { LocalBuildRegistryEntry } from '@shared/contracts/localBuild';
import { loadLocalBuildManifest } from './localBuildRepo';
import { listLocalBuildEntries, replaceLocalBuildEntries } from './registry';

const logger = scopedLogger('localBuilds.reconcile');

const entryFromManifest = (
  dir: string,
  manifest: { id: LocalBuildRegistryEntry['id']; name: string; updatedAt: string },
): LocalBuildRegistryEntry => ({
  id: manifest.id,
  name: manifest.name,
  dir,
  updatedAt: manifest.updatedAt,
});

// Best-effort self-heal run at startup: drops registry entries whose
// `instance.json` no longer loads and re-discovers local builds under the install
// root that are missing from the index. Official build folders have no
// `instance.json`, so they are ignored. Never throws — a reconcile failure must
// not crash bootstrap.
export const reconcileRegistry = async (): Promise<void> => {
  try {
    // Keyed by manifest id, not dir: the stored dir and the rediscovered dir can
    // spell the same path differently (joinClientFolder uses '/', path.join uses
    // the OS separator), so a dir-keyed map would duplicate every local build. The
    // id is canonical, so this also collapses any already-corrupt double entries.
    const byId = new Map<string, LocalBuildRegistryEntry>();

    for (const entry of listLocalBuildEntries()) {
      const manifest = await loadLocalBuildManifest(entry.dir);
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
        const manifest = await loadLocalBuildManifest(dir);
        if (manifest && !byId.has(manifest.id)) {
          byId.set(manifest.id, entryFromManifest(dir, manifest));
        }
      }
    }

    replaceLocalBuildEntries([...byId.values()]);
  } catch (error) {
    logger.warn('Failed to reconcile the local-build registry', error);
  }
};
