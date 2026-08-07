import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return { getClient: vi.fn() };
});

import { BundleManager } from '@main/services/bundle/manager';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { makeBroadcaster, makeHealer } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock the client lookup so syncForLaunch never makes a real network call. The
// previous version relied on getClient hitting http://test.invalid and failing
// fast; that DNS failure is not fast on CI runners, so the abort test timed out.
vi.mock('@main/services/clients', () => ({
  getClient: mocks.getClient,
}));

const KEY = asCatalogKey('official:test-client');

describe('BundleManager.syncForLaunch external signal', () => {
  it('throws ABORTED before touching client lookup when signal is already aborted', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer(), createClientOperationLocks());
    const controller = new AbortController();
    controller.abort();

    await expect(manager.syncForLaunch(KEY, controller.signal)).rejects.toMatchObject({
      code: BundleErrorCodes.ABORTED,
    });
    // Pre-abort short-circuits before any status broadcast.
    expect(broadcaster.status).not.toHaveBeenCalled();
  });

  it('attaches an abort listener that calls cancel mid-flight', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer(), createClientOperationLocks());
    const cancelSpy = vi.spyOn(manager, 'cancel');
    const controller = new AbortController();

    // getClient resolves null on the next microtask, keeping syncForLaunch
    // suspended at the lookup await long enough for the synchronous abort()
    // below to fire the listener; we don't care about the outcome, only that
    // firing the signal calls cancel.
    mocks.getClient.mockResolvedValue(null);
    const pending = manager.syncForLaunch(KEY, controller.signal).catch(() => {});
    controller.abort();
    await pending;

    expect(cancelSpy).toHaveBeenCalledWith(KEY);
  });
});
