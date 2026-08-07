import { scopedLogger } from '@main/infra/logger';
import type {
  CatalogItem,
  CatalogListResult,
  CatalogRef,
  SourceStatus,
} from '@shared/contracts/catalog';
import { parseCatalogKey, SourceKinds } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';
import type { CatalogSource } from './source';

const logger = scopedLogger('catalog');

// Local builds order by updatedAt, official builds by createdAt; sortCatalogItems
// keeps locals ahead of officials, most-recent first within each group.
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
// the backend is unreachable) is logged and marked degraded but never
// propagated, so a failing official source can never blank the local builds.
export type CatalogService = {
  list: (locale?: string) => Promise<CatalogListResult>;
  resolve: (ref: CatalogRef) => Promise<CatalogItem | null>;
  // Resolve a build from its CatalogKey (`official:<slug>` / `local:<uuid>`),
  // the cross-kind operational id that flows over IPC. The key names its source,
  // so resolution dispatches straight to it — a local build resolves
  // network-free, an official build hits the API. A malformed key resolves null.
  resolveBuildByKey: (key: CatalogKey) => Promise<CatalogItem | null>;
};

export const createCatalog = (sources: readonly CatalogSource[]): CatalogService => {
  // resolve/resolveBuildByKey are reached from launch and console paths that have
  // no locale in hand, so the catalog remembers the one the renderer last listed
  // with. Without it, every resolve fetches (and caches) the default locale.
  let lastLocale: string | undefined;

  const list = async (locale?: string): Promise<CatalogListResult> => {
    lastLocale = locale;
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
    return source.getItem(ref, lastLocale ? { locale: lastLocale } : {});
  };

  const resolveBuildByKey = async (key: CatalogKey): Promise<CatalogItem | null> => {
    const ref = parseCatalogKey(key);
    if (!ref) return null;
    return resolve(ref);
  };

  return { list, resolve, resolveBuildByKey };
};
