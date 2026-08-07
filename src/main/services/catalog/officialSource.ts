import { type CatalogItem, type CatalogRef, SourceKinds } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { type CatalogSource, type CatalogSourceOptions, clientToCatalogItem } from './source';

export type OfficialCatalogSourceDeps = {
  // Allowed to reject when the backend is unreachable and no offline snapshot
  // exists — the aggregator swallows it.
  listClients: (locale?: string) => Promise<Client[]>;
};

export const createOfficialCatalogSource = (deps: OfficialCatalogSourceDeps): CatalogSource => ({
  id: SourceKinds.OFFICIAL,
  listItems: async (opts): Promise<CatalogItem[]> => {
    const clients = await deps.listClients(opts?.locale);
    return clients.map(clientToCatalogItem);
  },
  getItem: async (ref: CatalogRef, opts?: CatalogSourceOptions): Promise<CatalogItem | null> => {
    if (ref.source !== SourceKinds.OFFICIAL) return null;
    // Must forward the locale: the client list is cached per locale, so dropping
    // it both renders default-locale titles (launch/console) and pays a second
    // /api/clients round trip plus an extra on-disk snapshot write.
    const clients = await deps.listClients(opts?.locale);
    const slug: ClientSlug = ref.slug;
    const client = clients.find((entry) => entry.slug === slug);
    return client ? clientToCatalogItem(client) : null;
  },
});
