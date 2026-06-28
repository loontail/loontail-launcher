import { beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  return {
    buildPlan: vi.fn(),
    fetchRemoteManifest: vi.fn(),
    getClient: vi.fn(),
    getSettings: vi.fn(),
    loadLocalManifest: vi.fn(),
    runSyncPhases: vi.fn(),
    saveLocalManifest: vi.fn(),
    logError: vi.fn(),
  };
});

import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import { BundleError, classifyBundleError } from '@main/services/bundle/errors';
import { BundleManager, type GetClient } from '@main/services/bundle/manager';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { BundleErrorCodes, BundleSyncStatuses } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { makeBroadcaster, makeHealer, makeLauncherSettings } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: managerMocks.logError,
  }),
}));

vi.mock('@main/services/settings/settings', () => ({ getSettings: managerMocks.getSettings }));
vi.mock('@main/services/bundle/api', () => ({
  fetchRemoteManifest: managerMocks.fetchRemoteManifest,
}));
vi.mock('@main/services/bundle/manifestRepo', () => ({
  clearLocalManifest: vi.fn(),
  loadLocalManifest: managerMocks.loadLocalManifest,
  saveLocalManifest: managerMocks.saveLocalManifest,
}));
vi.mock('@main/services/bundle/plan', () => ({ buildPlan: managerMocks.buildPlan }));
vi.mock('@main/services/bundle/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/runner')>();
  return { ...actual, runSyncPhases: managerMocks.runSyncPhases };
});

const SLUG = asCatalogKey('official:test-client');
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';

const fakeGetClient = managerMocks.getClient as unknown as GetClient;

const EMPTY_PLAN = {
  toDownload: [],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set<string>(),
  bytesTotal: 0,
};

const DOWNLOAD_PLAN = {
  ...EMPTY_PLAN,
  toDownload: [
    {
      path: 'mods/example.jar',
      name: 'example.jar',
      size: 1024,
      isDir: false,
      sha256: 'example-sha256',
      url: 'https://cdn.test.invalid/mods/example.jar',
    },
  ],
};

const launcherSettings = (clientFolder: string | null) =>
  makeLauncherSettings({
    // Empty clientsFolder so an absent per-client override resolves to no folder.
    storage: { clientsFolder: clientFolder ? '/tmp/clients' : '' },
    clients: clientFolder ? { [SLUG]: { storage: { clientFolder } } } : {},
  });

const errorCodes = (broadcaster: BundleBroadcaster) =>
  vi.mocked(broadcaster.error).mock.calls.map(([event]) => event.code);

beforeEach(() => {
  managerMocks.buildPlan.mockReset().mockResolvedValue(EMPTY_PLAN);
  managerMocks.fetchRemoteManifest
    .mockReset()
    .mockResolvedValue({ manifest: {}, manifestHash: 'empty-manifest-hash' });
  managerMocks.getClient.mockReset().mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
  managerMocks.getSettings.mockReset().mockReturnValue(launcherSettings(CLIENT_FOLDER));
  managerMocks.loadLocalManifest.mockReset().mockResolvedValue(null);
  managerMocks.runSyncPhases.mockReset().mockResolvedValue({ deletedAny: false });
  managerMocks.saveLocalManifest.mockReset().mockResolvedValue(undefined);
  managerMocks.logError.mockReset();
});

describe('classifyBundleError', () => {
  // DL-1: a BundleError code wins over an aborted signal so the sibling-abort
  // pattern (worker aborts the shared signal, then re-throws the real failure)
  // surfaces the genuine code instead of being masked as ABORTED.
  it('returns the BundleError code even when the signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      classifyBundleError(
        new BundleError(BundleErrorCodes.DOWNLOAD_FAILED, 'boom'),
        controller.signal,
      ),
    ).toBe(BundleErrorCodes.DOWNLOAD_FAILED);
  });

  it('returns ABORTED for a non-BundleError thrown against an aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyBundleError(new Error('plain'), controller.signal)).toBe(
      BundleErrorCodes.ABORTED,
    );
  });

  it('returns UNKNOWN for a non-BundleError with no aborted signal', () => {
    expect(classifyBundleError(new Error('plain'))).toBe(BundleErrorCodes.UNKNOWN);
  });
});

describe('BundleManager sync error surfacing', () => {
  // DLI-40
  it('maps a client fetch failure to MANIFEST_FETCH_FAILED, not UNKNOWN', async () => {
    managerMocks.getClient.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:8080'));
    const manager = new BundleManager(
      makeBroadcaster(),
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );

    await expect(manager.startSync({ slug: SLUG })).rejects.toMatchObject({
      code: BundleErrorCodes.MANIFEST_FETCH_FAILED,
    });
  });

  // DLI-40
  it('treats a genuine not-found client as UNKNOWN client-not-found', async () => {
    // getClient receives the bare official slug (officialSlugFor parses the CatalogKey),
    // so the not-found message the manager matches uses that bare slug, not the key.
    managerMocks.getClient.mockRejectedValue(new Error('Client "test-client" not found'));
    const manager = new BundleManager(
      makeBroadcaster(),
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );

    await expect(manager.startSync({ slug: SLUG })).rejects.toMatchObject({
      code: BundleErrorCodes.UNKNOWN,
    });
  });

  // DLI-41
  it('logs non-aborted sync failures at error level', async () => {
    managerMocks.buildPlan.mockResolvedValueOnce(DOWNLOAD_PLAN);
    managerMocks.runSyncPhases.mockRejectedValueOnce(
      new BundleError(BundleErrorCodes.DOWNLOAD_FAILED, 'boom'),
    );
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(
      broadcaster,
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );

    await manager.startSync({ slug: SLUG });

    expect(errorCodes(broadcaster)).toContain(BundleErrorCodes.DOWNLOAD_FAILED);
    expect(managerMocks.logError).toHaveBeenCalledWith(
      expect.stringContaining(BundleErrorCodes.DOWNLOAD_FAILED),
      expect.anything(),
    );
  });

  // DL-1: the sibling-abort pattern (worker aborts the shared signal, then the
  // phase re-throws the real BundleError) must surface the genuine code/status,
  // not be swallowed as ABORTED.
  it('surfaces a download integrity failure even when the abort signal already fired', async () => {
    managerMocks.buildPlan.mockResolvedValueOnce(DOWNLOAD_PLAN);
    managerMocks.runSyncPhases.mockImplementationOnce(async (task: { abort: AbortController }) => {
      task.abort.abort();
      throw new BundleError(BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED, 'sha256 mismatch');
    });
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(
      broadcaster,
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );

    await manager.startSync({ slug: SLUG });

    expect(errorCodes(broadcaster)).toContain(BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED);
    expect(vi.mocked(broadcaster.status).mock.calls.map(([event]) => event.status)).toContain(
      BundleSyncStatuses.ERROR,
    );
  });

  // DLI-43
  it('propagates a fresh-sync failure from resumeSync when no paused sync exists', async () => {
    managerMocks.getSettings.mockReturnValue(launcherSettings(null));
    const manager = new BundleManager(
      makeBroadcaster(),
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );

    await expect(manager.resumeSync(SLUG)).rejects.toMatchObject({
      code: BundleErrorCodes.NO_CLIENT_FOLDER,
    });
  });

  // DLI-55 / REP-15
  it('cancelAll awaits real sync completion rather than a fixed grace timer', async () => {
    managerMocks.getClient.mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
    managerMocks.buildPlan.mockResolvedValue(DOWNLOAD_PLAN);

    let releaseRun: () => void = () => {};
    let droppedDuringPhase = false;
    managerMocks.runSyncPhases.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      throw new BundleError(BundleErrorCodes.ABORTED, 'cancelled');
    });

    const broadcaster = makeBroadcaster();
    const activeSyncs = new Map();
    const manager = new BundleManager(
      broadcaster,
      makeHealer(),
      createClientOperationLocks(),
      activeSyncs,
      fakeGetClient,
    );

    void manager.startSync({ slug: SLUG });
    await vi.waitFor(() => expect(managerMocks.runSyncPhases).toHaveBeenCalledTimes(1));

    let cancelAllResolved = false;
    const cancelAll = manager.cancelAll(10_000).then(() => {
      cancelAllResolved = true;
      droppedDuringPhase = activeSyncs.size === 0;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(cancelAllResolved).toBe(false);

    releaseRun();
    await cancelAll;

    expect(cancelAllResolved).toBe(true);
    expect(droppedDuringPhase).toBe(true);
  });

  // DLI-55: a wedged sync must not block process exit beyond the timeout.
  it('cancelAll resolves on its timeout when a sync never completes', async () => {
    managerMocks.getClient.mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
    managerMocks.buildPlan.mockResolvedValue(DOWNLOAD_PLAN);
    managerMocks.runSyncPhases.mockImplementation(
      () => new Promise<{ deletedAny: boolean }>(() => {}),
    );

    const manager = new BundleManager(
      makeBroadcaster(),
      makeHealer(),
      createClientOperationLocks(),
      new Map(),
      fakeGetClient,
    );
    void manager.startSync({ slug: SLUG });
    await vi.waitFor(() => expect(managerMocks.runSyncPhases).toHaveBeenCalledTimes(1));

    await expect(manager.cancelAll(20)).resolves.toBeUndefined();
  });
});
