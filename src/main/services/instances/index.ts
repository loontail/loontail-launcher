import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { Router } from '@main/ipc/router';
import type { CatalogSource } from '@main/services/catalog/source';
import { createLocalCatalogSource } from './localSource';
import { reconcileRegistry } from './reconcile';
import { registerInstanceRoutes } from './routes';

export {
  createInstance,
  deleteInstance,
  listLoaderVersionOptions,
  listMinecraftVersionOptions,
  updateInstance,
} from './create';
export { createLocalCatalogSource, manifestToCatalogItem } from './localSource';
export {
  getInstanceEntry,
  listInstanceEntries,
  removeInstanceEntry,
  replaceInstanceEntries,
  upsertInstanceEntry,
} from './registry';
export {
  instanceManifestPath,
  loadInstanceManifest,
  removeInstanceDir,
  saveInstanceManifest,
} from './instanceRepo';
export { reconcileRegistry } from './reconcile';

export type InstancesService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
  // The local build source, registered with the catalog aggregator as primary.
  localSource: CatalogSource;
};

export const createInstancesService = (router: Router, kit: MinecraftKit): InstancesService => {
  const localSource = createLocalCatalogSource();
  return {
    init: async () => {
      registerInstanceRoutes(router, kit);
      await reconcileRegistry();
    },
    dispose: () => Promise.resolve(),
    localSource,
  };
};
