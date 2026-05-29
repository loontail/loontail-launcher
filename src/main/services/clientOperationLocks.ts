import type { ClientSlug } from '@shared/contracts/ids';

export const ClientOperationDomains = {
  MINECRAFT: 'minecraft',
  BUNDLE: 'bundle',
} as const;

export type ClientOperationDomain =
  (typeof ClientOperationDomains)[keyof typeof ClientOperationDomains];

export type ClientOperationLease = {
  readonly slug: ClientSlug;
  readonly domain: ClientOperationDomain;
  release: () => void;
};

export type ClientOperationAcquireResult =
  | { readonly kind: 'acquired'; readonly lease: ClientOperationLease }
  | { readonly kind: 'blocked'; readonly owner: ClientOperationDomain };

export type ClientOperationLocks = {
  acquire: (slug: ClientSlug, domain: ClientOperationDomain) => ClientOperationAcquireResult;
};

type LockEntry = {
  readonly domain: ClientOperationDomain;
  readonly token: symbol;
};

export const createClientOperationLocks = (): ClientOperationLocks => {
  const locks = new Map<ClientSlug, LockEntry>();

  return {
    acquire: (slug, domain) => {
      const current = locks.get(slug);
      if (current !== undefined) {
        return { kind: 'blocked', owner: current.domain };
      }

      const token = Symbol(domain);
      locks.set(slug, { domain, token });
      let released = false;

      return {
        kind: 'acquired',
        lease: {
          slug,
          domain,
          release: () => {
            if (released) return;
            released = true;
            if (locks.get(slug)?.token === token) {
              locks.delete(slug);
            }
          },
        },
      };
    },
  };
};
