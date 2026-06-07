import type { Router } from '@main/ipc/router';
import type { Client } from '@shared/contracts/client';
import type { StrapiList } from '@shared/contracts/strapi';
import { type CatalogService, createCatalog, setActiveCatalog } from './catalog';
import { registerCatalogRoutes } from './routes';
import type { CatalogSource } from './source';
import { createStrapiCatalogSource } from './strapiSource';

export type { CatalogService } from './catalog';
export type { CatalogSource } from './source';
export { clientToCatalogItem } from './source';
export { createStrapiCatalogSource } from './strapiSource';
export { createCatalog, resolveBuild, resolveBuildByOpaqueId, setActiveCatalog } from './catalog';

export type CatalogServiceDeps = {
  // The official source's fetch (the existing offline-snapshot-backed clients list).
  listClients: (locale?: string) => Promise<StrapiList<Client>>;
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
  const officialSource = createStrapiCatalogSource({ listClients: deps.listClients });
  const sources: CatalogSource[] = [...(deps.extraSources ?? []), officialSource];
  const catalog = createCatalog(sources);
  // Publish immediately (before init) so buildContext/healer can resolve builds
  // as soon as any service runs.
  setActiveCatalog(catalog);
  return {
    init: async () => {
      registerCatalogRoutes(router, catalog);
    },
    dispose: () => Promise.resolve(),
    catalog,
  };
};
