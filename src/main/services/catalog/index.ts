import type { Router } from '@main/ipc/router';
import type { Client } from '@shared/contracts/client';
import { type CatalogService, createCatalog } from './catalog';
import { createOfficialCatalogSource } from './officialSource';
import { registerCatalogRoutes } from './routes';
import type { CatalogSource } from './source';

export type { CatalogService } from './catalog';
export type { CatalogSource } from './source';
export { clientToCatalogItem } from './source';
export { createOfficialCatalogSource } from './officialSource';
export { createCatalog } from './catalog';

export type CatalogServiceDeps = {
  // The official source's fetch (the existing offline-snapshot-backed clients list).
  listClients: (locale?: string) => Promise<Client[]>;
  // Additional sources (e.g. the local instance source) registered ahead of the
  // official one so they list first.
  extraSources?: readonly CatalogSource[];
};

export type CatalogServiceHandle = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
  catalog: CatalogService;
};

export const createCatalogService = (
  router: Router,
  deps: CatalogServiceDeps,
): CatalogServiceHandle => {
  const officialSource = createOfficialCatalogSource({ listClients: deps.listClients });
  const sources: CatalogSource[] = [...(deps.extraSources ?? []), officialSource];
  const catalog = createCatalog(sources);
  return {
    init: async () => {
      registerCatalogRoutes(router, catalog);
    },
    dispose: () => Promise.resolve(),
    catalog,
  };
};
