import {
  ClientOperationDomains,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import { asCatalogKey } from '@shared/contracts/ids';
import { describe, expect, it } from 'vitest';

const ALPHA_SLUG = asCatalogKey('official:alpha');
const BETA_SLUG = asCatalogKey('official:beta');

describe('client operation locks', () => {
  it('blocks a second operation for the same client resource', () => {
    const locks = createClientOperationLocks();
    const minecraftLease = locks.acquire({
      slug: ALPHA_SLUG,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });
    if (minecraftLease.kind !== 'acquired') throw new Error('Expected minecraft lease');

    const bundleLease = locks.acquire({
      slug: ALPHA_SLUG,
      domain: ClientOperationDomains.BUNDLE,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });

    expect(bundleLease).toEqual({
      kind: 'blocked',
      owner: ClientOperationDomains.MINECRAFT,
      resource: ClientOperationResources.CLIENT_FOLDER,
    });
    minecraftLease.lease.release();
  });

  it('tracks operation metadata by client and resource class', () => {
    const locks = createClientOperationLocks();
    const runtimeLease = locks.acquire({
      slug: ALPHA_SLUG,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.RUNTIME_COMPONENT],
    });
    const manifestLease = locks.acquire({
      slug: ALPHA_SLUG,
      domain: ClientOperationDomains.BUNDLE,
      resources: [ClientOperationResources.BUNDLE_MANIFEST],
    });
    if (runtimeLease.kind !== 'acquired') throw new Error('Expected runtime lease');
    if (manifestLease.kind !== 'acquired') throw new Error('Expected manifest lease');

    expect(locks.list()).toEqual([
      {
        slug: ALPHA_SLUG,
        domain: ClientOperationDomains.BUNDLE,
        resources: [ClientOperationResources.BUNDLE_MANIFEST],
      },
      {
        slug: ALPHA_SLUG,
        domain: ClientOperationDomains.MINECRAFT,
        resources: [ClientOperationResources.RUNTIME_COMPONENT],
      },
    ]);

    runtimeLease.lease.release();
    manifestLease.lease.release();
  });

  it('cancels coordinated operations in deterministic order', () => {
    const locks = createClientOperationLocks();
    const calls: string[] = [];
    const minecraftLease = locks.acquire({
      slug: BETA_SLUG,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.CLIENT_FOLDER],
      cancel: () => calls.push('minecraft-beta'),
    });
    const bundleLease = locks.acquire({
      slug: ALPHA_SLUG,
      domain: ClientOperationDomains.BUNDLE,
      resources: [ClientOperationResources.BUNDLE_MANIFEST],
      cancel: () => calls.push('bundle-alpha'),
    });
    if (minecraftLease.kind !== 'acquired') throw new Error('Expected minecraft lease');
    if (bundleLease.kind !== 'acquired') throw new Error('Expected bundle lease');

    locks.cancelAll();

    expect(calls).toEqual(['bundle-alpha', 'minecraft-beta']);
    minecraftLease.lease.release();
    bundleLease.lease.release();
  });
});
