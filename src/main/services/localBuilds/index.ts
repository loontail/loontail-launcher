import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { CatalogSource } from '@main/services/catalog/source';
import type { LauncherService } from '@main/services/service';
import { createLocalCatalogSource } from './localSource';
import { reconcileRegistry } from './reconcile';
import { registerBuildRoutes } from './routes';

export {
  createLocalBuild,
  deleteLocalBuild,
  listLoaderVersionOptions,
  listMinecraftVersionOptions,
  updateLocalBuild,
} from './create';
export {
  loadLocalBuildManifest,
  localBuildManifestPath,
  removeLocalBuildDir,
  saveLocalBuildManifest,
} from './localBuildRepo';
export { createLocalCatalogSource, manifestToCatalogItem } from './localSource';
export { reconcileRegistry } from './reconcile';
export {
  getLocalBuildEntry,
  listLocalBuildEntries,
  removeLocalBuildEntry,
  replaceLocalBuildEntries,
  upsertLocalBuildEntry,
} from './registry';

export type LocalBuildsService = LauncherService & {
  localSource: CatalogSource;
};

export const createLocalBuildsService = (router: Router, kit: MinecraftKit): LocalBuildsService => {
  const localSource = createLocalCatalogSource();
  return {
    init: async () => {
      registerBuildRoutes(router, kit);
      await reconcileRegistry();
    },
    dispose: () => Promise.resolve(),
    localSource,
  };
};
