import { type CatalogItem, type CatalogRef, SourceKinds } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { type CatalogSource, clientToCatalogItem } from './source';

export type OfficialCatalogSourceDeps = {
  // Reuses the existing offline-snapshot-backed fetch; allowed to reject when
  // the CMS is unreachable and no snapshot exists — the aggregator swallows it.
  listClients: (locale?: string) => Promise<Client[]>;
};

// The official, CMS-curated source. A thin projection over the existing
// clients fetch; carries no new network or persistence concerns.
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
