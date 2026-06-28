import { type CatalogItem, type CatalogRef, SourceKinds } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { type CatalogSource, clientToCatalogItem } from './source';

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
  getItem: async (ref: CatalogRef): Promise<CatalogItem | null> => {
    if (ref.source !== SourceKinds.OFFICIAL) return null;
    const clients = await deps.listClients();
    const slug: ClientSlug = ref.slug;
    const client = clients.find((entry) => entry.slug === slug);
    return client ? clientToCatalogItem(client) : null;
  },
});
