import { scopedLogger } from '@main/infra/logger';
import type {
  CatalogItem,
  CatalogListResult,
  CatalogRef,
  SourceStatus,
} from '@shared/contracts/catalog';
import { SourceKinds } from '@shared/contracts/catalog';
import type { ClientSlug, InstanceId } from '@shared/contracts/ids';
import type { CatalogSource } from './source';

const logger = scopedLogger('catalog');

// Local builds first (most recently updated), then official builds (most
// recently created — preserving the prior official ordering). Stable per-group.
const sortKey = (item: CatalogItem): number => {
  const iso =
    item.kind === SourceKinds.LOCAL ? item.presentation.updatedAt : item.presentation.createdAt;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const sortCatalogItems = (items: CatalogItem[]): CatalogItem[] =>
  [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === SourceKinds.LOCAL ? -1 : 1;
    return sortKey(right) - sortKey(left);
  });

// Aggregates multiple build sources into one catalog. A source rejecting (e.g.
// CMS unreachable) is logged and marked degraded but never propagated, so a
// failing official source can never blank the local builds.
export type CatalogService = {
  list: (locale?: string) => Promise<CatalogListResult>;
  resolve: (ref: CatalogRef) => Promise<CatalogItem | null>;
};

export const createCatalog = (sources: readonly CatalogSource[]): CatalogService => {
  const list = async (locale?: string): Promise<CatalogListResult> => {
    const settled = await Promise.allSettled(
      sources.map((source) => source.listItems(locale ? { locale } : {})),
    );
    const items: CatalogItem[] = [];
    const statuses: SourceStatus[] = [];
    settled.forEach((result, index) => {
      const source = sources[index];
      if (!source) return;
      if (result.status === 'fulfilled') {
        items.push(...result.value);
        statuses.push({ id: source.id, ok: true });
      } else {
        logger.warn(`Catalog source "${source.id}" failed to list`, result.reason);
        statuses.push({ id: source.id, ok: false });
      }
    });
    return { items: sortCatalogItems(items), sources: statuses };
  };

  const resolve = async (ref: CatalogRef): Promise<CatalogItem | null> => {
    const source = sources.find((candidate) => candidate.id === ref.source);
    if (!source) return null;
    return source.getItem(ref);
  };

  return { list, resolve };
};

// Bootstrap installs the live catalog so module-level consumers (the minecraft
// buildContext and the bundle healer) can resolve a build by ref without
// threading the service through every call — mirroring the existing
// module-level clients accessors (getClient/getClients).
let activeCatalog: CatalogService | null = null;

export const setActiveCatalog = (catalog: CatalogService): void => {
  activeCatalog = catalog;
};

export const resolveBuild = (ref: CatalogRef): Promise<CatalogItem | null> => {
  if (!activeCatalog) {
    return Promise.reject(new Error('Catalog has not been initialized'));
  }
  return activeCatalog.resolve(ref);
};

// Resolve a build from the opaque operational id that flows through the
// slug-keyed install/launch chain. Local ids (UUIDs) are tried first and never
// touch the network, so a local build resolves with the CMS unreachable; only a
// non-local id falls through to the official (Strapi) source. The id keyspaces
// do not overlap (UUID vs human slug), so this is unambiguous.
export const resolveBuildByOpaqueId = async (id: ClientSlug): Promise<CatalogItem | null> => {
  const local = await resolveBuild({ source: SourceKinds.LOCAL, id: id as unknown as InstanceId });
  if (local) return local;
  return resolveBuild({ source: SourceKinds.OFFICIAL, slug: id });
};
