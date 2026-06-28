import type { CatalogKey } from '@shared/contracts/ids';

export const ClientOperationDomains = {
  MINECRAFT: 'minecraft',
  BUNDLE: 'bundle',
} as const;

export type ClientOperationDomain =
  (typeof ClientOperationDomains)[keyof typeof ClientOperationDomains];

export const ClientOperationResources = {
  CLIENT_FOLDER: 'client-folder',
  RUNTIME_COMPONENT: 'runtime-component',
  BUNDLE_MANIFEST: 'bundle-manifest',
} as const;

export type ClientOperationResource =
  (typeof ClientOperationResources)[keyof typeof ClientOperationResources];

export type ClientOperationCancel = () => void;

export type ClientOperationDescriptor = {
  readonly slug: CatalogKey;
  readonly domain: ClientOperationDomain;
  readonly resources: readonly ClientOperationResource[];
  readonly cancel?: ClientOperationCancel;
};

export type ClientOperationLease = {
  readonly slug: CatalogKey;
  readonly domain: ClientOperationDomain;
  readonly resources: readonly ClientOperationResource[];
  setCancel: (cancel: ClientOperationCancel | null) => void;
  release: () => void;
};

export type ClientOperationAcquireResult =
  | { readonly kind: 'acquired'; readonly lease: ClientOperationLease }
  | {
      readonly kind: 'blocked';
      readonly owner: ClientOperationDomain;
      readonly resource: ClientOperationResource;
    };

export type ClientOperationSnapshot = {
  readonly slug: CatalogKey;
  readonly domain: ClientOperationDomain;
  readonly resources: readonly ClientOperationResource[];
};

export type ClientOperationLocks = {
  acquire: (descriptor: ClientOperationDescriptor) => ClientOperationAcquireResult;
  list: () => readonly ClientOperationSnapshot[];
  cancelAll: () => void;
};

type LockEntry = {
  readonly slug: CatalogKey;
  readonly domain: ClientOperationDomain;
  readonly resources: readonly ClientOperationResource[];
  readonly token: symbol;
  readonly sequence: number;
  cancel: ClientOperationCancel | null;
};

type ResourceEntry = {
  readonly domain: ClientOperationDomain;
  readonly token: symbol;
  readonly resource: ClientOperationResource;
};

const CANCEL_DOMAIN_ORDER: Record<ClientOperationDomain, number> = {
  [ClientOperationDomains.BUNDLE]: 0,
  [ClientOperationDomains.MINECRAFT]: 1,
};

const resourceKey = (slug: CatalogKey, resource: ClientOperationResource): string =>
  `${slug}\u0000${resource}`;

const dedupeResources = (
  resources: readonly ClientOperationResource[],
): readonly ClientOperationResource[] => [...new Set(resources)];

const compareEntries = (left: LockEntry, right: LockEntry): number => {
  const domainDelta = CANCEL_DOMAIN_ORDER[left.domain] - CANCEL_DOMAIN_ORDER[right.domain];
  if (domainDelta !== 0) return domainDelta;
  const slugDelta = left.slug.localeCompare(right.slug);
  if (slugDelta !== 0) return slugDelta;
  return left.sequence - right.sequence;
};

export const createClientOperationLocks = (): ClientOperationLocks => {
  const resourceLocks = new Map<string, ResourceEntry>();
  const operations = new Map<symbol, LockEntry>();
  let nextSequence = 0;

  return {
    acquire: (descriptor) => {
      const resources = dedupeResources(descriptor.resources);
      for (const resource of resources) {
        const current = resourceLocks.get(resourceKey(descriptor.slug, resource));
        if (current !== undefined) {
          return { kind: 'blocked', owner: current.domain, resource: current.resource };
        }
      }

      const token = Symbol(descriptor.domain);
      const entry: LockEntry = {
        slug: descriptor.slug,
        domain: descriptor.domain,
        resources,
        token,
        sequence: nextSequence,
        cancel: descriptor.cancel ?? null,
      };
      nextSequence += 1;

      operations.set(token, entry);
      for (const resource of resources) {
        resourceLocks.set(resourceKey(descriptor.slug, resource), {
          domain: descriptor.domain,
          token,
          resource,
        });
      }

      let released = false;

      return {
        kind: 'acquired',
        lease: {
          slug: descriptor.slug,
          domain: descriptor.domain,
          resources,
          setCancel: (cancel) => {
            entry.cancel = cancel;
          },
          release: () => {
            if (released) return;
            released = true;
            operations.delete(token);
            for (const resource of resources) {
              const key = resourceKey(descriptor.slug, resource);
              if (resourceLocks.get(key)?.token === token) {
                resourceLocks.delete(key);
              }
            }
          },
        },
      };
    },
    list: () =>
      [...operations.values()].sort(compareEntries).map((entry) => ({
        slug: entry.slug,
        domain: entry.domain,
        resources: entry.resources,
      })),
    cancelAll: () => {
      const entries = [...operations.values()].sort(compareEntries);
      for (const entry of entries) {
        entry.cancel?.();
      }
    },
  };
};
